// Stem Separation mit Demucs als Core ML (macOS): schneller als demucs.cpp, auf der GPU oder der CPU.
// Gleiche Ausgabe wie demucs.cpp (target_<i>_<name>.wav), damit der Server beide gleich behandelt.
//
//   soniq-demucs <modell.mlpackage> <eingabe.wav> <ausgabe-ordner> <gpu|cpu>
//
// Zwei Arten von Modellen, an den Eingängen erkannt (wie in der App Gig Songbook):
//   Wellenform ("mix" → "sources", htdemucs_6s): die STFT steckt im Modell. Mix auf Mittelwert und Streuung normiert
//     wie in demucs.apply_model. Gemessen (90 s, M2 Pro): GPU 6 s, CPU 11 s, demucs.cpp 57 s; die GPU rechnet hier
//     ungenauer (gegen die echten Spuren im Mittel 1,3 dB schlechter als die CPU, vor allem beim Bass).
//   Wellenform plus Spektrum ("audio_waveform" + "spectral_magnitude" → "time_output" + "freq_output", htdemucs mit
//     4 Spuren): STFT und inverse STFT hier, mit den Funktionen aus Gig Songbook (HTDemucsSeparationEngine.swift,
//     unverändert übernommen), auf dem rohen Mix. Gemessen: GPU 5 s, CPU 6 s, beide gleich genau und etwas besser
//     als demucs.cpp mit htdemucs_ft (342 s).
// Stücke fester Länge mit 25 % Überlappung und Dreiecks-Gewichten, am Ende mit Nullen aufgefüllt.
import Accelerate
import AVFoundation
import CoreML
import Foundation

/** Spurnamen der Ausgabe in Kanalreihenfolge (je Spur zwei Kanäle), wie demucs.cpp */
let SOURCES: [Int: [String]] = [
  8: ["drums", "bass", "other", "vocals"],
  12: ["drums", "bass", "other", "vocals", "guitar", "piano"],
]
let OVERLAP = 0.25
let RATE = 44_100.0

struct Failure: Error, CustomStringConvertible {
  let description: String
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("soniq-demucs: \(message)\n".utf8))
  exit(1)
}

/// STFT für Modelle mit Spektrum-Eingang: aus Gig Songbook (HTDemucsSeparationEngine.swift) übernommen
enum GigSpec {
  static let fftSize = 4096
  static let hopSize = 1024
  static let numBins = 2048   // fftSize / 2
  static let numFrames = 336
  static let segmentLength = 343_980
  // Periodic Hann window matching PyTorch's hann_window(periodic=True)
  static let window: [Float] = (0..<4096).map { Float(0.5 * (1.0 - cos(2.0 * .pi * Double($0) / 4096.0))) }

  static func reflectPad(signal: [Float], left: Int, right: Int) -> [Float] {
    let n = signal.count
    var padded = [Float](repeating: 0, count: n + left + right)
    for i in 0..<left { padded[i] = signal[left - i] }
    _ = signal.withUnsafeBufferPointer { src in
      padded.withUnsafeMutableBufferPointer { dst in
        memcpy(dst.baseAddress! + left, src.baseAddress!, n * MemoryLayout<Float>.size)
      }
    }
    for i in 0..<right { padded[left + n + i] = signal[n - 2 - i] }
    return padded
  }

  static func computeSpectralInput(left: [Float], right: [Float]) -> [Float] {
    let specPadLeft  = hopSize / 2 * 3
    let specPadRight = specPadLeft + numFrames * hopSize - segmentLength
    let channelSize  = numBins * numFrames
    var result = [Float](repeating: 0, count: 4 * channelSize)

    for (ch, signal) in [left, right].enumerated() {
      let padded = reflectPad(signal: signal, left: specPadLeft, right: specPadRight)
      let (real, imag, _) = forwardSTFT(signal: padded)
      let realCh = ch * 2
      let imagCh = ch * 2 + 1
      result.withUnsafeMutableBufferPointer { dst in
        _ = real.withUnsafeBufferPointer { src in
          memcpy(dst.baseAddress! + realCh * channelSize, src.baseAddress!, channelSize * MemoryLayout<Float>.size)
        }
        _ = imag.withUnsafeBufferPointer { src in
          memcpy(dst.baseAddress! + imagCh * channelSize, src.baseAddress!, channelSize * MemoryLayout<Float>.size)
        }
      }
    }

    // Normalise to match Python's torch.stft(normalized=True)
    var normScale = Float(1.0 / sqrt(Double(fftSize)))
    vDSP_vsmul(result, 1, &normScale, &result, 1, vDSP_Length(result.count))
    return result
  }

  static func forwardSTFT(signal: [Float]) -> (real: [Float], imag: [Float], frames: Int) {
    let log2n = vDSP_Length(log2(Float(fftSize)))
    guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return ([], [], 0) }
    defer { vDSP_destroy_fftsetup(fftSetup) }

    let halfN       = fftSize / 2
    let totalFrames = max(1, (signal.count - fftSize) / hopSize + 1)
    var allReal = [Float](repeating: 0, count: numBins * totalFrames)
    var allImag = [Float](repeating: 0, count: numBins * totalFrames)
    var frame = [Float](repeating: 0, count: fftSize)
    var rp    = [Float](repeating: 0, count: halfN)
    var ip    = [Float](repeating: 0, count: halfN)

    for f in 0..<totalFrames {
      let start = f * hopSize
      let avail = min(fftSize, max(0, signal.count - start))
      vDSP_vclr(&frame, 1, vDSP_Length(fftSize))
      if avail > 0 {
        _ = signal.withUnsafeBufferPointer { buf in
          frame.withUnsafeMutableBufferPointer { dst in
            memcpy(dst.baseAddress!, buf.baseAddress! + start, avail * MemoryLayout<Float>.size)
          }
        }
      }
      vDSP_vmul(frame, 1, window, 1, &frame, 1, vDSP_Length(fftSize))

      frame.withUnsafeBufferPointer { src in
        src.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
          rp.withUnsafeMutableBufferPointer { rpBuf in
            ip.withUnsafeMutableBufferPointer { ipBuf in
              var sc = DSPSplitComplex(realp: rpBuf.baseAddress!, imagp: ipBuf.baseAddress!)
              vDSP_ctoz(complexPtr, 2, &sc, 1, vDSP_Length(halfN))
            }
          }
        }
      }
      rp.withUnsafeMutableBufferPointer { rpBuf in
        ip.withUnsafeMutableBufferPointer { ipBuf in
          var sc = DSPSplitComplex(realp: rpBuf.baseAddress!, imagp: ipBuf.baseAddress!)
          vDSP_fft_zrip(fftSetup, &sc, 1, log2n, FFTDirection(kFFTDirection_Forward))
        }
      }

      allReal[f] = rp[0] * 0.5
      allImag[f] = 0
      for k in 1..<numBins {
        let idx = k * totalFrames + f
        allReal[idx] = rp[k] * 0.5
        allImag[idx] = ip[k] * 0.5
      }
    }
    return (allReal, allImag, totalFrames)
  }

  static func inverseSTFT(real: [Float], imag: [Float], outputLength: Int) -> [Float] {
    let log2n = vDSP_Length(log2(Float(fftSize)))
    guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return [] }
    defer { vDSP_destroy_fftsetup(fftSetup) }

    let halfN       = fftSize / 2
    let totalFrames = real.count / numBins
    var output    = [Float](repeating: 0, count: outputLength)
    var windowSum = [Float](repeating: 0, count: outputLength)
    var rp    = [Float](repeating: 0, count: halfN)
    var ip    = [Float](repeating: 0, count: halfN)
    var frame = [Float](repeating: 0, count: fftSize)

    for f in 0..<totalFrames {
      rp[0] = real[f] * 2.0
      ip[0] = 0
      for k in 1..<numBins {
        let idx = k * totalFrames + f
        rp[k] = real[idx] * 2.0
        ip[k] = imag[idx] * 2.0
      }

      rp.withUnsafeMutableBufferPointer { rpBuf in
        ip.withUnsafeMutableBufferPointer { ipBuf in
          var sc = DSPSplitComplex(realp: rpBuf.baseAddress!, imagp: ipBuf.baseAddress!)
          vDSP_fft_zrip(fftSetup, &sc, 1, log2n, FFTDirection(kFFTDirection_Inverse))
        }
      }
      rp.withUnsafeBufferPointer { rpBuf in
        ip.withUnsafeBufferPointer { ipBuf in
          var sc = DSPSplitComplex(
            realp: UnsafeMutablePointer(mutating: rpBuf.baseAddress!),
            imagp: UnsafeMutablePointer(mutating: ipBuf.baseAddress!)
          )
          frame.withUnsafeMutableBufferPointer { dst in
            dst.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
              vDSP_ztoc(&sc, 1, complexPtr, 2, vDSP_Length(halfN))
            }
          }
        }
      }

      var scale: Float = 1.0 / Float(2 * fftSize)
      vDSP_vsmul(frame, 1, &scale, &frame, 1, vDSP_Length(fftSize))
      vDSP_vmul(frame, 1, window, 1, &frame, 1, vDSP_Length(fftSize))

      let start = f * hopSize
      for i in 0..<fftSize {
        let idx = start + i
        if idx < outputLength {
          output[idx]    += frame[i]
          windowSum[idx] += window[i] * window[i]
        }
      }
    }

    for i in 0..<outputLength {
      if windowSum[i] > 1e-8 { output[i] /= windowSum[i] }
    }
    return output
  }

  static func inverseSpec(real: [Float], imag: [Float]) -> [Float] {
    let totalFrames = numFrames + 4
    let specPad     = hopSize / 2 * 3
    let centerPad   = fftSize / 2

    var paddedReal = [Float](repeating: 0, count: numBins * totalFrames)
    var paddedImag = [Float](repeating: 0, count: numBins * totalFrames)
    for bin in 0..<numBins {
      let srcOffset = bin * numFrames
      let dstOffset = bin * totalFrames + 2
      _ = real.withUnsafeBufferPointer { src in
        paddedReal.withUnsafeMutableBufferPointer { dst in
          memcpy(dst.baseAddress! + dstOffset, src.baseAddress! + srcOffset, numFrames * MemoryLayout<Float>.size)
        }
      }
      _ = imag.withUnsafeBufferPointer { src in
        paddedImag.withUnsafeMutableBufferPointer { dst in
          memcpy(dst.baseAddress! + dstOffset, src.baseAddress! + srcOffset, numFrames * MemoryLayout<Float>.size)
        }
      }
    }

    let rawLen    = (totalFrames - 1) * hopSize + fftSize
    let rawOutput = inverseSTFT(real: paddedReal, imag: paddedImag, outputLength: rawLen)
    let trimStart = centerPad + specPad
    return Array(rawOutput[trimStart..<trimStart + segmentLength])
  }
}

/// Kanal [batch 0, channel, …] eines Ausgangs zeilenweise ([Höhe][Breite]; 1D: Höhe 1). Float 32 oder 16: das
/// 4-Spur-Modell liefert trotz "f32" im Namen Float 16 (Gig Songbook wandelt ebenso um).
func channel(_ a: MLMultiArray, _ c: Int) -> [Float] {
  let strides = a.strides.map(\.intValue), shape = a.shape.map(\.intValue)
  let h = shape.count == 4 ? shape[2] : 1, w = shape[shape.count - 1]
  let hs = shape.count == 4 ? strides[2] : 0, ws = strides[strides.count - 1]
  var out = [Float](repeating: 0, count: h * w)
  func copy<T>(_ type: T.Type, _ value: (T) -> Float) {
    let p = a.dataPointer.bindMemory(to: T.self, capacity: a.count)
    for y in 0..<h { for x in 0..<w { out[y * w + x] = value(p[c * strides[1] + y * hs + x * ws]) } }
  }
  if a.dataType == .float16 { copy(Float16.self) { Float($0) } } else { copy(Float.self) { $0 } }
  return out
}

/// Ausgänge, die sich lesen lassen
func readable(_ a: MLMultiArray?) -> MLMultiArray? {
  guard let a, a.dataType == .float32 || a.dataType == .float16 else { return nil }
  return a
}

/// Ein Modell und wie es ein Stück trennt: Stereo-Stück → Spuren als [Spur * 2 + Kanal][Sample]
struct Separator {
  let model: MLModel
  let segment: Int
  let names: [String]
  /// Mix vorher normieren (nur bei Modellen mit STFT im Modell, gemessen)
  let normalize: Bool
  let run: (MLModel, [Float], [Float]) throws -> [[Float]]
}

func makeSeparator(_ model: MLModel) throws -> Separator {
  let ins = model.modelDescription.inputDescriptionsByName, outs = model.modelDescription.outputDescriptionsByName
  if ins["audio_waveform"] != nil && ins["spectral_magnitude"] != nil && outs["time_output"] != nil && outs["freq_output"] != nil {
    let seg = GigSpec.segmentLength
    let names = SOURCES[8]!
    return Separator(model: model, segment: seg, names: names, normalize: false) { model, left, right in
      let spectral = try MLMultiArray(shape: [1, 4, NSNumber(value: GigSpec.numBins), NSNumber(value: GigSpec.numFrames)], dataType: .float32)
      let sp = spectral.dataPointer.bindMemory(to: Float.self, capacity: spectral.count), ss = spectral.strides.map(\.intValue)
      let data = GigSpec.computeSpectralInput(left: left, right: right)
      for c in 0..<4 { for h in 0..<GigSpec.numBins { for w in 0..<GigSpec.numFrames {
        sp[c * ss[1] + h * ss[2] + w * ss[3]] = data[(c * GigSpec.numBins + h) * GigSpec.numFrames + w]
      } } }
      let wave = try MLMultiArray(shape: [1, 2, NSNumber(value: seg)], dataType: .float32)
      let wp = wave.dataPointer.bindMemory(to: Float.self, capacity: wave.count), ws = wave.strides.map(\.intValue)
      for i in 0..<seg { wp[i * ws[2]] = left[i]; wp[ws[1] + i * ws[2]] = right[i] }
      let out = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: ["spectral_magnitude": spectral, "audio_waveform": wave]))
      guard let freq = readable(out.featureValue(for: "freq_output")?.multiArrayValue),
            let time = readable(out.featureValue(for: "time_output")?.multiArrayValue) else { throw Failure(description: "unexpected model output") }
      // inverse STFT wie torch.stft(normalized=True) zurückgerechnet, dazu der Zeit-Zweig
      let scale = Float(Double(GigSpec.fftSize).squareRoot())
      var stems: [[Float]] = []
      for s in 0..<names.count {
        for c in 0..<2 {
          let f = GigSpec.inverseSpec(real: channel(freq, 4 * s + 2 * c), imag: channel(freq, 4 * s + 2 * c + 1))
          let t = channel(time, 2 * s + c)
          stems.append((0..<seg).map { f[$0] * scale + t[$0] })
        }
      }
      return stems
    }
  }
  guard ins.count == 1, let (inName, inDesc) = ins.first, let (outName, outDesc) = outs.first,
        let inShape = inDesc.multiArrayConstraint?.shape.map(\.intValue), inShape.count == 3, inShape[1] == 2,
        let outShape = outDesc.multiArrayConstraint?.shape.map(\.intValue), outShape.count == 3,
        let names = SOURCES[outShape[1]] else {
    throw Failure(description: "unsupported model: expected input [1, 2, N] → [1, 8|12, N], or audio_waveform + spectral_magnitude")
  }
  let seg = inShape[2]
  return Separator(model: model, segment: seg, names: names, normalize: true) { model, left, right in
    let chunk = try MLMultiArray(shape: inShape.map { NSNumber(value: $0) }, dataType: .float32)
    let p = chunk.dataPointer.bindMemory(to: Float.self, capacity: chunk.count), cs = chunk.strides.map(\.intValue)
    for i in 0..<seg { p[i * cs[2]] = left[i]; p[cs[1] + i * cs[2]] = right[i] }
    let result = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(multiArray: chunk)]))
    guard let o = readable(result.featureValue(for: outName)?.multiArrayValue) else { throw Failure(description: "unexpected model output") }
    return (0..<outShape[1]).map { channel(o, $0) }
  }
}

/// Kompiliertes Modell neben dem Paket (<name>.mlmodelc); fehlt es oder ist es älter, wird es einmal erzeugt.
func compiledModel(_ package: URL) throws -> URL {
  let fm = FileManager.default
  let target = package.deletingPathExtension().appendingPathExtension("mlmodelc")
  let modified = { (url: URL) in (try? fm.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? .distantPast }
  if fm.fileExists(atPath: target.path) && modified(target) >= modified(package) { return target }
  let temp = try MLModel.compileModel(at: package)
  let staging = target.deletingLastPathComponent().appendingPathComponent(".\(target.lastPathComponent).\(getpid())")
  try? fm.removeItem(at: staging)
  try fm.moveItem(at: temp, to: staging)
  try? fm.removeItem(at: target)
  try fm.moveItem(at: staging, to: target)
  return target
}

func readStereo(_ url: URL) throws -> [[Float]] {
  let file = try AVAudioFile(forReading: url)
  guard file.fileFormat.sampleRate == RATE else { throw Failure(description: "input must be 44100 Hz, is \(file.fileFormat.sampleRate)") }
  let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: RATE, channels: file.processingFormat.channelCount, interleaved: false)!
  guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else { throw Failure(description: "input too long") }
  try file.read(into: buffer)
  let n = Int(buffer.frameLength), channels = Int(format.channelCount)
  return (0..<2).map { c in Array(UnsafeBufferPointer(start: buffer.floatChannelData![min(c, channels - 1)], count: n)) }
}

func writeStereo(_ left: [Float], _ right: [Float], to url: URL) throws {
  let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: RATE, channels: 2, interleaved: false)!
  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(left.count))!
  buffer.frameLength = AVAudioFrameCount(left.count)
  left.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: left.count) }
  right.withUnsafeBufferPointer { buffer.floatChannelData![1].update(from: $0.baseAddress!, count: right.count) }
  let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: RATE, AVNumberOfChannelsKey: 2,
    AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
  ]
  let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
  try file.write(from: buffer)
}

func separate(package: URL, input: URL, outDir: URL, units: MLComputeUnits) throws {
  let config = MLModelConfiguration()
  config.computeUnits = units
  let sep = try makeSeparator(try MLModel(contentsOf: try compiledModel(package), configuration: config))
  let seg = sep.segment, stride = Int(Double(seg) * (1 - OVERLAP))

  var mix = try readStereo(input)
  let n = mix[0].count
  guard n > 0 else { throw Failure(description: "input is empty") }
  // Normieren wie demucs: Mittelwert und Streuung des Mono-Mix, danach zurückrechnen
  var mean: Float = 0, std: Float = 1
  if sep.normalize {
    var sq: Float = 0
    for i in 0..<n { mean += (mix[0][i] + mix[1][i]) / 2 }
    mean /= Float(n)
    for i in 0..<n { let d = (mix[0][i] + mix[1][i]) / 2 - mean; sq += d * d }
    std = (sq / Float(max(n - 1, 1))).squareRoot() + 1e-8
    for c in 0..<2 { for i in 0..<n { mix[c][i] = (mix[c][i] - mean) / std } }
  }

  // Dreiecks-Gewicht über das Stück (demucs: 1 … seg/2 … 1)
  var weight = [Float](repeating: 0, count: seg)
  for i in 0..<seg { weight[i] = Float(i < seg / 2 ? i + 1 : seg - i) / Float(seg / 2) }

  let channels = sep.names.count * 2
  var out = [[Float]](repeating: [Float](repeating: 0, count: n), count: channels)
  var sumW = [Float](repeating: 0, count: n)
  let total = (n + stride - 1) / stride
  var offset = 0, done = 0
  while offset < n {
    let piece = (0..<2).map { c in (0..<seg).map { i in offset + i < n ? mix[c][offset + i] : 0 } }
    let stems = try sep.run(sep.model, piece[0], piece[1])
    for i in 0..<min(seg, n - offset) {
      let j = offset + i, w = weight[i]
      for k in 0..<channels { out[k][j] += stems[k][i] * w }
      sumW[j] += w
    }
    done += 1
    FileHandle.standardError.write(Data("progress \(done)/\(total)\n".utf8))
    offset += stride
  }

  try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
  for (s, name) in sep.names.enumerated() {
    let scale = { (k: Int) in (0..<n).map { out[k][$0] / max(sumW[$0], 1e-8) * std + mean } }
    try writeStereo(scale(s * 2), scale(s * 2 + 1), to: outDir.appendingPathComponent("target_\(s)_\(name).wav"))
  }
}

let args = CommandLine.arguments
guard args.count == 5, ["gpu", "cpu"].contains(args[4]) else { fail("usage: soniq-demucs <model.mlpackage> <in.wav> <out-dir> <gpu|cpu>") }
do {
  try separate(package: URL(fileURLWithPath: args[1]), input: URL(fileURLWithPath: args[2]), outDir: URL(fileURLWithPath: args[3]),
               units: args[4] == "gpu" ? .cpuAndGPU : .cpuOnly)
} catch {
  fail("\(error)")
}
