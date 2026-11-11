// Значок приложения: swift scripts/gen-icon.swift App/Assets.xcassets/AppIcon.appiconset/icon-1024.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let size = 1024.0
// ровно 1024×1024 без альфы — так требует App Store
let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
let colors = [NSColor(red: 0.07, green: 0.09, blue: 0.20, alpha: 1).cgColor, NSColor(red: 0.16, green: 0.36, blue: 0.95, alpha: 1).cgColor] as CFArray
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: 0), end: CGPoint(x: size, y: size), options: [])
// щит
let shield = NSBezierPath()
let cx = size / 2, top = size * 0.84, bottom = size * 0.14, half = size * 0.30
shield.move(to: NSPoint(x: cx - half, y: top - size * 0.06))
shield.line(to: NSPoint(x: cx, y: top))
shield.line(to: NSPoint(x: cx + half, y: top - size * 0.06))
shield.line(to: NSPoint(x: cx + half, y: size * 0.46))
shield.curve(to: NSPoint(x: cx, y: bottom), controlPoint1: NSPoint(x: cx + half, y: size * 0.25), controlPoint2: NSPoint(x: cx + half * 0.5, y: bottom + size * 0.03))
shield.curve(to: NSPoint(x: cx - half, y: size * 0.46), controlPoint1: NSPoint(x: cx - half * 0.5, y: bottom + size * 0.03), controlPoint2: NSPoint(x: cx - half, y: size * 0.25))
shield.close()
NSColor(white: 1, alpha: 0.14).setFill(); shield.fill()
NSColor(white: 1, alpha: 0.9).setStroke(); shield.lineWidth = 22; shield.stroke()
// надпись
let para = NSMutableParagraphStyle(); para.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 250, weight: .heavy), .foregroundColor: NSColor.white, .paragraphStyle: para, .kern: -6]
NSAttributedString(string: "WYX", attributes: attrs).draw(in: NSRect(x: 0, y: size * 0.36, width: size, height: 300))
NSGraphicsContext.restoreGraphicsState()
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
print("ok", out)
