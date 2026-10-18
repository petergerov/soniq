// SONIQ.app: kleine Menüleisten-App um die Web-App. Startet das Backend (Node.js) mit MG_PACKAGED=1, das
// seinerseits den Modellserver startet und bei fehlenden Modellen die Einrichtung zeigt; öffnet den Browser.
// Beenden stoppt das Backend (und damit den Modellserver). Hält das Backend selbst an ("Server stoppen" in der
// Oberfläche), beendet sich auch die App.
//
// Aufbau des Bundles (siehe macos/build-app.sh):
//   Contents/MacOS/SONIQ, node, ace-server      Programme
//   Contents/MacOS/demucs_*.cpp.main            Stem Separation mit Demucs (Gewichte lädt die App nach)
//   Contents/Frameworks/libggml*.dylib          Bibliotheken des Modellservers
//   Contents/Resources/app/                     backend/src, shared, scripts/common.sh, frontend/dist
// Daten und Modelle: ~/Library/Application Support/SONIQ/{data,models}
// Für Tests: SONIQ_PORT (statt 8765) und SONIQ_HOME (statt Application Support/SONIQ); weitere MG_*-Variablen gehen
// unverändert ans Backend (z. B. MG_SYNTH_PORT, MG_HF_BASE).
import AppKit

let env = ProcessInfo.processInfo.environment
let port = Int(env["SONIQ_PORT"] ?? "") ?? 8765
let appURL = URL(string: "http://127.0.0.1:\(port)/")!

/// Menütexte in den Sprachen der Oberfläche, nach der Systemsprache.
let texts: [String: (open: String, quit: String, folder: String, busy: String, failed: String)] = [
  "de": ("SONIQ öffnen", "SONIQ beenden", "Daten-Ordner zeigen", "Port \(port) ist belegt. Läuft SONIQ schon (z. B. aus dem Projektordner)? Bitte erst dort beenden.", "SONIQ wurde unerwartet beendet. Details im Protokoll:"),
  "en": ("Open SONIQ", "Quit SONIQ", "Show Data Folder", "Port \(port) is in use. Is SONIQ already running (e.g. from the project folder)? Please stop it there first.", "SONIQ stopped unexpectedly. Details in the log:"),
  "es": ("Abrir SONIQ", "Salir de SONIQ", "Mostrar carpeta de datos", "El puerto \(port) está ocupado. ¿SONIQ ya está en marcha (p. ej. desde la carpeta del proyecto)? Detenlo allí primero.", "SONIQ se cerró inesperadamente. Detalles en el registro:"),
  "fr": ("Ouvrir SONIQ", "Quitter SONIQ", "Afficher le dossier de données", "Le port \(port) est occupé. SONIQ tourne-t-il déjà (p. ex. depuis le dossier du projet) ? Arrête-le d'abord.", "SONIQ s'est arrêté de façon inattendue. Détails dans le journal :"),
  "it": ("Apri SONIQ", "Esci da SONIQ", "Mostra cartella dati", "La porta \(port) è occupata. SONIQ è già in esecuzione (ad es. dalla cartella del progetto)? Fermalo prima lì.", "SONIQ si è chiuso inaspettatamente. Dettagli nel registro:"),
  "pt": ("Abrir SONIQ", "Sair do SONIQ", "Mostrar pasta de dados", "A porta \(port) está em uso. O SONIQ já está rodando (p. ex. da pasta do projeto)? Pare-o lá primeiro.", "O SONIQ parou inesperadamente. Detalhes no registro:"),
  "tr": ("SONIQ'i aç", "SONIQ'ten çık", "Veri klasörünü göster", "\(port) numaralı port kullanımda. SONIQ zaten çalışıyor mu (ör. proje klasöründen)? Önce orada durdur.", "SONIQ beklenmedik şekilde durdu. Ayrıntılar günlükte:"),
  "pl": ("Otwórz SONIQ", "Zakończ SONIQ", "Pokaż folder danych", "Port \(port) jest zajęty. Czy SONIQ już działa (np. z folderu projektu)? Najpierw zatrzymaj go tam.", "SONIQ nieoczekiwanie się zatrzymał. Szczegóły w logu:"),
  "ru": ("Открыть SONIQ", "Выйти из SONIQ", "Показать папку данных", "Порт \(port) занят. SONIQ уже запущен (например, из папки проекта)? Сначала останови его там.", "SONIQ неожиданно завершился. Подробности в журнале:"),
  "uk": ("Відкрити SONIQ", "Вийти з SONIQ", "Показати теку даних", "Порт \(port) зайнятий. SONIQ уже запущено (наприклад, з теки проєкту)? Спершу зупини його там.", "SONIQ несподівано завершився. Подробиці в журналі:"),
  "ja": ("SONIQ を開く", "SONIQ を終了", "データフォルダを表示", "ポート \(port) は使用中です。SONIQ がすでに起動していませんか (プロジェクトフォルダから等)? 先にそちらを停止してください。", "SONIQ が予期せず終了しました。詳細はログを参照:"),
  "zh": ("打开 SONIQ", "退出 SONIQ", "显示数据文件夹", "端口 \(port) 已被占用。SONIQ 是否已在运行 (例如从项目文件夹)? 请先在那里停止。", "SONIQ 意外停止。详情见日志:"),
]
let t = texts[String((Locale.preferredLanguages.first ?? "en").prefix(2))] ?? texts["en"]!

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private var server: Process?
  private var quitting = false
  private let contents = Bundle.main.bundleURL.appendingPathComponent("Contents")
  private lazy var support: URL = env["SONIQ_HOME"].map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("SONIQ")
  private lazy var dataDir = support.appendingPathComponent("data")
  private lazy var modelsDir = support.appendingPathComponent("models")
  private lazy var logFile = dataDir.appendingPathComponent("server.log")

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    if portInUse() {
      alert(t.busy)
      NSApp.terminate(nil)
      return
    }
    startServer()
  }

  /// Erneut geöffnet (Doppelklick, während die App läuft): Browser zeigen.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    openBrowser()
    return false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let server, server.isRunning else { return .terminateNow }
    quitting = true
    server.terminate()   // SIGTERM: Backend stoppt Modellserver und Datenbank sauber
    // Hier warten statt .terminateLater: dessen Rückmeldung käme in der Beenden-Schleife von AppKit nicht an
    let deadline = Date().addingTimeInterval(10)
    while server.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
    if server.isRunning { kill(server.processIdentifier, SIGKILL) }
    return .terminateNow
  }

  private func buildMenu() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let image = NSImage(systemSymbolName: "music.note", accessibilityDescription: "SONIQ")
    image?.isTemplate = true
    statusItem.button?.image = image
    let menu = NSMenu()
    menu.addItem(NSMenuItem(title: t.open, action: #selector(openBrowser), keyEquivalent: "o"))
    menu.addItem(NSMenuItem(title: t.folder, action: #selector(showData), keyEquivalent: ""))
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: t.quit, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    statusItem.menu = menu
  }

  private func startServer() {
    try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    try? FileManager.default.createDirectory(at: modelsDir, withIntermediateDirectories: true)
    let app = contents.appendingPathComponent("Resources/app")
    let process = Process()
    process.executableURL = contents.appendingPathComponent("MacOS/node")
    process.arguments = ["--disable-warning=ExperimentalWarning", app.appendingPathComponent("backend/src/main.ts").path, "--port", String(port)]
    process.currentDirectoryURL = app
    var serverEnv = env
    serverEnv["MG_PACKAGED"] = "1"
    serverEnv["MG_DATA_DIR"] = dataDir.path
    serverEnv["MG_MODELS_DIR"] = modelsDir.path
    serverEnv["MG_ENGINE_BIN"] = contents.appendingPathComponent("MacOS/ace-server").path
    serverEnv["MG_DEMUCS_DIR"] = contents.appendingPathComponent("MacOS").path
    // Version der App (für die Update-Prüfung gegen GitHub-Releases)
    serverEnv["MG_APP_VERSION"] = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    process.environment = serverEnv
    if !FileManager.default.fileExists(atPath: logFile.path) { FileManager.default.createFile(atPath: logFile.path, contents: nil) }
    if let log = try? FileHandle(forWritingTo: logFile) {
      log.seekToEndOfFile()
      process.standardOutput = log
      process.standardError = log
    }
    process.terminationHandler = { [weak self] p in
      DispatchQueue.main.async {
        guard let self, !self.quitting else { return }
        // Backend hat sich selbst beendet: "Server stoppen" (Exit 0) oder abgestürzt
        if p.terminationStatus != 0 { self.alert("\(t.failed)\n\(self.logFile.path)") }
        NSApp.terminate(nil)
      }
    }
    do {
      try process.run()
      server = process
      waitAndOpen(deadline: Date().addingTimeInterval(30))
    } catch {
      alert("\(t.failed)\n\(error.localizedDescription)")
      NSApp.terminate(nil)
    }
  }

  /// Browser öffnen, sobald die Web-App antwortet.
  private func waitAndOpen(deadline: Date) {
    var request = URLRequest(url: appURL)
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
      DispatchQueue.main.async {
        guard let self, self.server?.isRunning == true else { return }
        if (response as? HTTPURLResponse)?.statusCode == 200 { self.openBrowser() }
        else if Date() < deadline { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitAndOpen(deadline: deadline) } }
      }
    }.resume()
  }

  private func portInUse() -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(UInt16(port).bigEndian)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    return withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
    }
  }

  @objc private func openBrowser() {
    NSWorkspace.shared.open(appURL)
  }

  @objc private func showData() {
    NSWorkspace.shared.activateFileViewerSelecting([dataDir])
  }

  private func alert(_ message: String) {
    NSApp.activate(ignoringOtherApps: true)
    let a = NSAlert()
    a.messageText = "SONIQ"
    a.informativeText = message
    a.runModal()
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // nur Menüleiste, kein Dock-Symbol
// SIGTERM (kill, Abmelden): wie "Beenden", damit Backend und Modellserver nicht übrig bleiben
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()
app.run()
