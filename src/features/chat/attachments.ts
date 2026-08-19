export interface ChatAttachment {
  name: string
  mimeType: string
  dataUrl: string
  width?: number
  height?: number
}

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  return {
    name: file.name,
    mimeType: file.type || 'image/png',
    dataUrl,
  }
}
