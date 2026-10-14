// Updates aus dem GitHub-Repository: prüfen, holen, Server neu starten.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatus } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { GitError, type Git } from "../infrastructure/git.ts";
import { psQuote, type ProcessLauncher } from "../infrastructure/process-launcher.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { Translate } from "../i18n/translator.ts";

export const BRANCH = "main";
export const REPO_URL = "https://github.com/petergerov/soniq.git";
/** Ändern sich diese Dateien (neue acestep.cpp- oder Node-Version), muss der Installer noch einmal laufen. */
const INSTALLER_FILES = ["scripts/common.sh", "scripts/common.ps1"];

export interface UpdateServiceDeps {
  root: string;
  platform: NodeJS.Platform;
  /** Fertige App: kommt als neue App-Version, nicht per Git */
  packaged: boolean;
  git: Git;
  songs: SongRepository;
  launcher: ProcessLauncher;
  /** Startbefehl dieses Servers: Programm + Argumente */
  serverCommand: string[];
  port: number;
}

export class UpdateService {
  private readonly deps: UpdateServiceDeps;

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps;
  }

  async status(t: Translate): Promise<UpdateStatus> {
    if (this.deps.packaged) throw new AppError("bad_request", "upd_packaged");
    const { git } = this.deps;
    if (!(await this.hasHead())) {
      // Ohne Git installiert (z. B. als ZIP geladen): Version unbekannt, das Update stellt auf Git um
      const latest = (await git.run(["ls-remote", REPO_URL, BRANCH], 30)).split(/\s+/)[0];
      if (!latest) throw new AppError("upstream", "gh_unreachable");
      return { current: "?", latest: latest.slice(0, 7), behind: 1, ahead: 0, dirty: false, needs_install: false, nogit: true, changes: [t("nogit_change")] };
    }
    await git.run(["fetch", "--quiet", "origin", BRANCH], 30);
    const remote = `origin/${BRANCH}`;
    const behind = Number(await git.run(["rev-list", "--count", `HEAD..${remote}`]));
    const ahead = Number(await git.run(["rev-list", "--count", `${remote}..HEAD`]));
    const changes = behind ? await git.lines(["log", `HEAD..${remote}`, "--format=%s", "-n", "15"]) : [];
    const changedFiles = behind ? await git.lines(["diff", "--name-only", `HEAD..${remote}`]) : [];
    return {
      current: await git.run(["rev-parse", "--short", "HEAD"]),
      latest: await git.run(["rev-parse", "--short", remote]),
      behind, ahead, changes,
      dirty: Boolean(await git.run(["status", "--porcelain", "--untracked-files=no"])),
      needs_install: changedFiles.some((f) => INSTALLER_FILES.includes(f)),
    };
  }

  async apply(t: Translate): Promise<UpdateStatus> {
    if (this.deps.songs.countActive()) throw new AppError("conflict", "busy");
    const s = await this.status(t);
    if (!s.behind) throw new AppError("bad_request", "up_to_date");
    if (s.dirty) throw new AppError("bad_request", "dirty");
    if (s.ahead) throw new AppError("bad_request", "ahead");
    if (s.nogit) return this.convertToGit(s);
    await this.deps.git.run(["pull", "--ff-only", "--quiet", "origin", BRANCH], 120);
    return { ...s, current: await this.deps.git.run(["rev-parse", "--short", "HEAD"]) };
  }

  /** Neuen Server abgekoppelt starten, der wartet, bis der Port frei ist; dann diesen beenden. */
  scheduleRestart(delayMs = 800): void {
    setTimeout(() => {
      const { platform, port, serverCommand, root, launcher } = this.deps;
      const log = join(root, "data", "server.log");
      if (platform === "win32") {
        const [exe, ...args] = serverCommand;
        const command =
          `while (Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }; ` +
          `& ${psQuote(exe!)} ${args.map(psQuote).join(" ")}`;
        launcher.launchDetached(command, { cwd: root, logFile: log });
      } else {
        const quoted = serverCommand.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(" ");
        const command =
          `while (command -v lsof >/dev/null 2>&1 && lsof -i :${port} -sTCP:LISTEN -t >/dev/null 2>&1) || ` +
          `(command -v ss >/dev/null 2>&1 && ss -tlpn "sport = :${port}" 2>/dev/null | grep -q LISTEN); do sleep 0.3; done; exec ${quoted}`;
        launcher.launchDetached(command, { cwd: root, logFile: log });
      }
      process.kill(process.pid, "SIGTERM");
    }, delayMs);
  }

  /** Verständlicher Text für Git-Fehler. */
  describe(e: unknown, t: Translate): string {
    if (e instanceof GitError && e.timedOut) return t("gh_timeout");
    const msg = (e as Error).message || String(e);
    if (msg.includes("Could not resolve") || msg.includes("unable to access")) return t("gh_unreachable");
    return msg;
  }

  private async hasHead(): Promise<boolean> {
    if (!this.deps.git.hasRepository()) return false;
    try {
      await this.deps.git.run(["rev-parse", "--verify", "--quiet", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private acestepRevision(): string {
    try {
      return readFileSync(join(this.deps.root, "scripts", "common.sh"), "utf8").split(/\r?\n/).find((l) => l.startsWith("ACESTEP_REV=")) ?? "";
    } catch {
      return "";
    }
  }

  /** Ordner ohne .git in ein Git-Repository verwandeln. data/, engine/ und runtime/ sind ignoriert und bleiben unberührt. */
  private async convertToGit(s: UpdateStatus): Promise<UpdateStatus> {
    const { git } = this.deps;
    const oldRevision = this.acestepRevision();
    if (!git.hasRepository()) await git.run(["init", "-q", "-b", BRANCH]);
    if (!(await git.run(["remote"])).split(/\s+/).includes("origin")) await git.run(["remote", "add", "origin", REPO_URL]);
    await git.run(["fetch", "--quiet", "origin", BRANCH], 120);
    await git.run(["checkout", "--quiet", "-B", BRANCH, `origin/${BRANCH}`, "--force"]);
    await git.run(["branch", "--set-upstream-to", `origin/${BRANCH}`, BRANCH]);
    return { ...s, current: await git.run(["rev-parse", "--short", "HEAD"]), needs_install: this.acestepRevision() !== oldRevision };
  }
}
