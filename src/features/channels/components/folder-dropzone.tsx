import { useCallback, useRef, useState } from 'react'
import { FolderOpen, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/context/i18n-provider'
import { Button } from '@/components/ui/button'

/**
 * 本地文件夹选择
 *
 * 三条路径都支持（PRD §4.3）：
 *  1. 点击选择文件夹（input webkitdirectory）
 *  2. 拖拽文件夹进来（DataTransferItem.webkitGetAsEntry 递归遍历）
 *  3. 拖拽散装 JSON 文件
 *
 * 注意：浏览器出于安全限制**拿不到绝对路径**，只能拿到
 * `webkitRelativePath`（形如 `tech-ai-hub/20260809/a.json`）。
 * 这对本平台够用：展示与去重键都只依赖相对路径 + 文件名，
 * 绝对路径由后端在服务端读取时补全。
 */

export type PickedFile = {
  /** 相对路径，用于展示与生成 publishKey */
  path: string
  name: string
  text: string
}

type FolderDropzoneProps = {
  onFiles: (files: PickedFile[]) => void
  disabled?: boolean
  className?: string
}

const isJson = (name: string) => name.toLowerCase().endsWith('.json')

/** 递归遍历拖入的目录条目 */
async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: { path: string; file: File }[]
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      ;(entry as FileSystemFileEntry).file(
        (result) => resolve(result),
        () => resolve(null)
      )
    })
    if (file && isJson(file.name)) {
      out.push({ path: prefix ? `${prefix}/${file.name}` : file.name, file })
    }
    return
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries 每次最多返回 100 项，必须循环读到空为止
    let batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(
        (results) => resolve(results),
        () => resolve([])
      )
    })
    while (batch.length > 0) {
      for (const child of batch) {
        await walkEntry(
          child,
          prefix ? `${prefix}/${entry.name}` : entry.name,
          out
        )
      }
      batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (results) => resolve(results),
          () => resolve([])
        )
      })
    }
  }
}

export function FolderDropzone({
  onFiles,
  disabled,
  className,
}: FolderDropzoneProps) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const readFiles = useCallback(
    async (entries: { path: string; file: File }[]) => {
      if (entries.length === 0) {
        onFiles([])
        return
      }
      setReading(true)
      try {
        const picked: PickedFile[] = []
        for (const entry of entries) {
          try {
            const text = await entry.file.text()
            picked.push({
              path: entry.path,
              name: entry.file.name,
              text,
            })
          } catch {
            // 单个文件读失败就跳过，不阻塞其他文件（PRD §4.3）
          }
        }
        onFiles(picked)
      } finally {
        setReading(false)
      }
    },
    [onFiles]
  )

  const handleInput = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return
      const entries = Array.from(fileList)
        .filter((file) => isJson(file.name))
        .map((file) => ({
          // webkitRelativePath 在选文件夹时才有值
          path: file.webkitRelativePath || file.name,
          file,
        }))
      await readFiles(entries)
    },
    [readFiles]
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(false)
      if (disabled) return

      const items = Array.from(event.dataTransfer.items)
      const entries = items
        .map((item) =>
          'webkitGetAsEntry' in item
            ? (
                item as DataTransferItem & {
                  webkitGetAsEntry: () => FileSystemEntry | null
                }
              ).webkitGetAsEntry()
            : null
        )
        .filter((entry): entry is FileSystemEntry => Boolean(entry))

      if (entries.length > 0) {
        const collected: { path: string; file: File }[] = []
        for (const entry of entries) {
          await walkEntry(entry, '', collected)
        }
        await readFiles(collected)
        return
      }

      // 退化路径：拿不到 entry 时按普通文件处理
      const files = Array.from(event.dataTransfer.files)
        .filter((file) => isJson(file.name))
        .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
      await readFiles(files)
    },
    [disabled, readFiles]
  )

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition',
        dragging && 'border-primary bg-primary/5',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      <div className='flex size-10 items-center justify-center rounded-full bg-muted'>
        {reading ? (
          <Loader2 className='size-5 animate-spin text-muted-foreground' />
        ) : (
          <Upload className='size-5 text-muted-foreground' />
        )}
      </div>
      <div className='space-y-1'>
        <p className='text-sm font-medium'>
          {reading
            ? t('channels.dropzone.reading')
            : t('channels.dropzone.idle')}
        </p>
        <p className='text-xs text-muted-foreground'>
          {t('channels.dropzone.hint')}
        </p>
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={disabled || reading}
        onClick={() => inputRef.current?.click()}
      >
        <FolderOpen className='size-4' />
        {t('channels.dropzone.pick')}
      </Button>
      <input
        ref={inputRef}
        type='file'
        multiple
        // @ts-expect-error webkitdirectory 不在标准类型里，但主流浏览器都支持
        webkitdirectory=''
        directory=''
        className='hidden'
        onChange={(event) => {
          void handleInput(event.target.files)
          // 允许连续选择同一个文件夹
          event.target.value = ''
        }}
      />
    </div>
  )
}
