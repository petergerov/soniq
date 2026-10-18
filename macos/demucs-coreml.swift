// Stem Separation mit Demucs als Core ML (macOS): schneller als demucs.cpp, auf der GPU oder der CPU.
// Gleiche Ausgabe wie demucs.cpp (target_<i>_<name>.wav), damit der Server beide gleich behandelt.
//
//   soniq-demucs <modell.mlpackage> <eingabe.wav> <ausgabe-ordner> <gpu|cpu>
//
// Das Modell nimmt das Stereo-Signal (44,1 kHz) in Stücken fester Länge und rechnet die STFT selbst. Getrennt wird wie
// in demucs.apply_model: Mix auf Mittelwert und Streuung normiert, Stücke mit 25 % Überlappung, Dreiecks-Gewichte.
// Gemessen (90 s, M2 Pro, htdemucs_6s): GPU 6 s, CPU 11 s, demucs.cpp mit 4 Threads 57 s. Die GPU rechnet ungenauer
// (gegen die echten Spuren im Mittel 1,3 dB schlechter als die CPU, vor allem beim Bass), die CPU so genau wie
// demucs.cpp.
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
  let model = try MLModel(contentsOf: try compiledModel(package), configuration: config)
  let desc = model.modelDescription
  guard desc.inputDescriptionsByName.count == 1, let (inName, inDesc) = desc.inputDescriptionsByName.first,
        let (outName, outDesc) = desc.outputDescriptionsByName.first,
        let inShape = inDesc.multiArrayConstraint?.shape.map(\.intValue), inShape.count == 3, inShape[1] == 2,
        let outShape = outDesc.multiArrayConstraint?.shape.map(\.intValue), outShape.count == 3,
        let names = SOURCES[outShape[1]] else {
    throw Failure(description: "unsupported model: expected input [1, 2, N] and output [1, 8|12, N] (STFT inside the model)")
  }
  let seg = inShape[2], stride = Int(Double(seg) * (1 - OVERLAP))

  var mix = try readStereo(input)
  let n = mix[0].count
  guard n > 0 else { throw Failure(description: "input is empty") }
  // Normieren wie demucs: Mittelwert und Streuung des Mono-Mix, danach zurückrechnen
  var mean: Float = 0, sq: Float = 0
  for i in 0..<n { mean += (mix[0][i] + mix[1][i]) / 2 }
  mean /= Float(n)
  for i in 0..<n { let d = (mix[0][i] + mix[1][i]) / 2 - mean; sq += d * d }
  let std = (sq / Float(max(n - 1, 1))).squareRoot() + 1e-8
  for c in 0..<2 { for i in 0..<n { mix[c][i] = (mix[c][i] - mean) / std } }

  // Dreiecks-Gewicht über das Stück (demucs: 1 … seg/2 … 1)
  var weight = [Float](repeating: 0, count: seg)
  for i in 0..<seg { weight[i] = Float(i < seg / 2 ? i + 1 : seg - i) / Float(seg / 2) }

  let channels = outShape[1]
  var out = [[Float]](repeating: [Float](repeating: 0, count: n), count: channels)
  var sumW = [Float](repeating: 0, count: n)
  let chunk = try MLMultiArray(shape: inShape.map { NSNumber(value: $0) }, dataType: .float32)
  let p = chunk.dataPointer.bindMemory(to: Float.self, capacity: 2 * seg)
  let cs = chunk.strides.map(\.intValue)
  let total = (n + stride - 1) / stride
  var offset = 0, done = 0
  while offset < n {
    for c in 0..<2 { for i in 0..<seg { let j = offset + i; p[c * cs[1] + i * cs[2]] = j < n ? mix[c][j] : 0 } }
    let result = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(multiArray: chunk)]))
    guard let o = result.featureValue(for: outName)?.multiArrayValue, o.dataType == .float32 else { throw Failure(description: "unexpected model output") }
    let op = o.dataPointer.bindMemory(to: Float.self, capacity: o.count)
    let s1 = o.strides[1].intValue, s2 = o.strides[2].intValue
    for i in 0..<min(seg, n - offset) {
      let j = offset + i, w = weight[i]
      for k in 0..<channels { out[k][j] += op[k * s1 + i * s2] * w }
      sumW[j] += w
    }
    done += 1
    FileHandle.standardError.write(Data("progress \(done)/\(total)\n".utf8))
    offset += stride
  }

  try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
  for (s, name) in names.enumerated() {
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
