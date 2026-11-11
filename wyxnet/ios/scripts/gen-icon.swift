// Значок как у мессенджера WYX (sux-chat-app/.../AppIcon-512@2x.png): тёмно-бирюзовый фон,
// «X» из двух лаймовых капсул с градиентом сверху вниз; отличие — тонкое кольцо «сети».
// swift scripts/gen-icon.swift App/Assets.xcassets/AppIcon.appiconset/icon-1024.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let size: CGFloat = 1024
let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
// фон
ctx.setFillColor(rgb(0x345B56))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
// кольцо сети
ctx.setStrokeColor(rgb(0xC5F068, 0.13))
ctx.setLineWidth(26)
ctx.strokeEllipse(in: CGRect(x: 72, y: 72, width: size - 144, height: size - 144))
// две капсулы под ±45°
let c = CGPoint(x: size / 2, y: size / 2)
let length: CGFloat = 690, thick: CGFloat = 190
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                      colors: [rgb(0xC8F56A, 0.96), rgb(0xA6D862, 0.96), rgb(0x6E9E5C, 0.96)] as CFArray, locations: [0, 0.5, 1])!
for angle in [CGFloat.pi / 4, -CGFloat.pi / 4] {
    ctx.saveGState()
    ctx.translateBy(x: c.x, y: c.y)
    ctx.rotate(by: angle)
    let r = CGRect(x: -length / 2, y: -thick / 2, width: length, height: thick)
    let path = CGPath(roundedRect: r, cornerWidth: thick / 2, cornerHeight: thick / 2, transform: nil)
    ctx.addPath(path)
    ctx.clip()
    // градиент сверху вниз в координатах холста
    ctx.rotate(by: -angle)
    ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: length / 2), end: CGPoint(x: 0, y: -length / 2), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    ctx.restoreGState()
    // стеклянная кайма
    ctx.saveGState()
    ctx.translateBy(x: c.x, y: c.y)
    ctx.rotate(by: angle)
    ctx.addPath(CGPath(roundedRect: CGRect(x: -length / 2, y: -thick / 2, width: length, height: thick), cornerWidth: thick / 2, cornerHeight: thick / 2, transform: nil))
    ctx.setStrokeColor(rgb(0xFFFFFF, 0.28))
    ctx.setLineWidth(5)
    ctx.strokePath()
    ctx.restoreGState()
}
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("ok", out)
