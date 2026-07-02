#!/usr/bin/swift
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: vision-ocr.swift <image-path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Failed to load image: \(imagePath)\n", stderr)
    exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("Vision error: \(error)\n", stderr)
    exit(3)
}

guard let observations = request.results else { exit(0) }

struct Line {
    let text: String
    let y: CGFloat
    let x: CGFloat
}

var lines: [Line] = []
for obs in observations {
    guard let candidate = obs.topCandidates(1).first else { continue }
    let box = obs.boundingBox
    lines.append(Line(text: candidate.string, y: box.origin.y, x: box.origin.x))
}

lines.sort {
    if abs($0.y - $1.y) > 0.012 { return $0.y > $1.y }
    return $0.x < $1.x
}

var output: [String] = []
var lastY: CGFloat = -1
for line in lines {
    if lastY >= 0 && abs(line.y - lastY) > 0.012 {
        output.append("")
    }
    output.append(line.text)
    lastY = line.y
}

print(output.joined(separator: "\n"))
