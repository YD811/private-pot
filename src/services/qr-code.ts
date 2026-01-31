import type { Buffer } from 'node:buffer'
import { createCanvas } from 'canvas'
import QRCode from 'qrcode'

/**
 * Generate a Solana Pay QR code with group name as a buffer
 * Format: solana:<address>
 */
export async function generateSolanaPayQR(
  address: string,
  groupName?: string,
): Promise<Buffer> {
  const solanaPayUrl = `solana:${address}`

  // Generate QR code to canvas
  const qrSize = 350
  const padding = 30
  const headerHeight = groupName ? 50 : 0
  const footerHeight = 60
  const totalWidth = qrSize + padding * 2
  const totalHeight = qrSize + padding * 2 + headerHeight + footerHeight

  const canvas = createCanvas(totalWidth, totalHeight)
  const ctx = canvas.getContext('2d')

  // White background
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, totalWidth, totalHeight)

  // Draw group name header
  if (groupName) {
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 20px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(groupName, totalWidth / 2, padding + 25, totalWidth - padding * 2)
  }

  // Generate QR code and draw it
  const qrCanvas = createCanvas(qrSize, qrSize)
  await QRCode.toCanvas(qrCanvas, solanaPayUrl, {
    width: qrSize,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  })

  // Draw QR code on main canvas
  ctx.drawImage(qrCanvas, padding, padding + headerHeight)

  // Draw "Scan to deposit SOL" footer
  ctx.fillStyle = '#666666'
  ctx.font = '16px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('Scan with Phantom, Solflare, etc.', totalWidth / 2, totalHeight - padding - 20)

  ctx.fillStyle = '#9945FF' // Solana purple
  ctx.font = 'bold 18px Arial'
  ctx.fillText('Deposit SOL', totalWidth / 2, totalHeight - padding)

  return canvas.toBuffer('image/png') as Buffer
}
