'use client'

import {
  ActionIcon,
  Box,
  Button,
  Center,
  FileInput,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconFile, IconFolder, IconRefresh, IconUpload } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

interface FileItem {
  path: string
  type: 'file' | 'directory'
  name: string
}

interface FileExplorerProps {
  sessionId: string
  onFileSelect?: (filePath: string) => void
  selectedFile?: string | null
}

export default function FileExplorer({ sessionId, onFileSelect, selectedFile }: FileExplorerProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef<HTMLButtonElement>(null)

  const fetchFileSystem = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        sessionId: sessionId
      })
      
      const response = await fetch(`/api/filesystem?${params}`)
      if (response.ok) {
        const data = await response.json()
        setFiles(data.files || [])
      }
    } catch (error) {
      console.error('Failed to fetch filesystem:', error)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    fetchFileSystem()
  }, [sessionId])

  useEffect(() => {
    // Listen for filesystem updates from chat
    const handleUpdate = () => {
      fetchFileSystem()
    }
    
    window.addEventListener('filesystem-update', handleUpdate)
    return () => window.removeEventListener('filesystem-update', handleUpdate)
  }, [])

  const handleFileClick = (item: FileItem) => {
    if (item.type === 'file' && onFileSelect) {
      onFileSelect(item.path)
    }
  }

  const handleUpload = async (file: File | null) => {
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('sessionId', sessionId)
    // Backend type is now controlled by environment variable

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        notifications.show({
          title: 'Upload successful',
          message: `File "${file.name}" uploaded successfully`,
          color: 'green'
        })
        await fetchFileSystem() // Refresh the file list
      } else {
        const errorText = await response.text()
        notifications.show({
          title: 'Upload failed',
          message: errorText,
          color: 'red'
        })
      }
    } catch (error) {
      notifications.show({
        title: 'Upload error',
        message: error instanceof Error ? error.message : 'Unknown error',
        color: 'red'
      })
    }
  }

  const handleDownload = async (filePath: string) => {
    try {
      const params = new URLSearchParams({
        sessionId: sessionId,
        file: filePath
      })
      
      const response = await fetch(`/api/download?${params}`)
      
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filePath.split('/').pop() || 'download'
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        
        notifications.show({
          title: 'Download started',
          message: `Downloading ${filePath.split('/').pop()}`,
          color: 'green'
        })
      } else {
        const errorText = await response.text()
        notifications.show({
          title: 'Download failed',
          message: errorText,
          color: 'red'
        })
      }
    } catch (error) {
      notifications.show({
        title: 'Download error',
        message: error instanceof Error ? error.message : 'Unknown error',
        color: 'red'
      })
    }
  }

  const renderFileTree = (items: FileItem[], prefix: string = '') => {
    // Sort directories first, then files
    const sorted = [...items].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return sorted.map((item, index) => (
      <Group 
        key={item.path} 
        justify="space-between"
        p="sm"
        style={{
          cursor: item.type === 'file' ? 'pointer' : 'default',
          backgroundColor: item.type === 'file' && selectedFile === item.path 
            ? 'rgba(34, 139, 230, 0.15)' 
            : undefined,
          borderRadius: '12px',
          border: item.type === 'file' && selectedFile === item.path
            ? '1px solid rgba(34, 139, 230, 0.4)'
            : '1px solid transparent',
          transition: 'all 0.3s ease',
          boxShadow: item.type === 'file' && selectedFile === item.path
            ? '0 4px 12px rgba(34, 139, 230, 0.1)'
            : 'none'
        }}
        onClick={() => handleFileClick(item)}
        onMouseEnter={(e) => {
          if (item.type === 'file' && selectedFile !== item.path) {
            e.currentTarget.style.backgroundColor = 'rgba(34, 139, 230, 0.08)'
            e.currentTarget.style.border = '1px solid rgba(34, 139, 230, 0.2)'
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(34, 139, 230, 0.1)'
          }
        }}
        onMouseLeave={(e) => {
          if (item.type === 'file' && selectedFile !== item.path) {
            e.currentTarget.style.backgroundColor = ''
            e.currentTarget.style.border = '1px solid transparent'
            e.currentTarget.style.transform = ''
            e.currentTarget.style.boxShadow = 'none'
          }
        }}
      >
        <Group gap="xs">
          {item.type === 'directory' ? 
            <IconFolder size={16} color="var(--mantine-color-yellow-5)" /> : 
            <IconFile size={16} color="var(--mantine-color-blue-5)" />
          }
          <Text size="sm">
            {prefix}{item.name}{item.type === 'directory' && '/'}
          </Text>
        </Group>
        {item.type === 'file' && (
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              handleDownload(item.path)
            }}
          >
            <IconDownload size={14} />
          </ActionIcon>
        )}
      </Group>
    ))
  }

  return (
    <Box 
      style={{ 
        width: '300px',
        height: '100%',
        padding: '20px',
        borderRight: '1px solid rgba(34, 139, 230, 0.2)',
        background: 'linear-gradient(135deg, var(--mantine-color-dark-7) 0%, var(--mantine-color-dark-6) 100%)',
        backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(34, 139, 230, 0.03) 0%, transparent 50%)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        boxShadow: '2px 0 12px rgba(0, 0, 0, 0.1)'
      }}
    >
      <Stack gap="md" style={{ height: '100%', minHeight: 0 }}>
        <Group justify="space-between">
          <Text 
            fw={700} 
            size="lg"
            c="blue.4"
          >
            📁 Workspace
          </Text>
          <Group gap="xs">
            <FileInput
              placeholder=""
              size="xs"
              style={{ display: 'none' }}
              onChange={handleUpload}
              accept="*"
              ref={fileInputRef as React.RefObject<HTMLButtonElement>}
            />
            <Button 
              size="xs" 
              variant="light" 
              leftSection={<IconUpload size={14} />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload
            </Button>
            <ActionIcon 
              variant="light" 
              size="sm"
              onClick={fetchFileSystem}
              loading={isLoading}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <ScrollArea flex={1} styles={{
          viewport: {
            paddingRight: '8px'
          }
        }}>
          <Stack gap="xs">
            {isLoading ? (
              <Center p="xl">
                <Loader size="sm" />
              </Center>
            ) : files.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" p="xl">
                No files yet. Start by asking the AI to create something!
              </Text>
            ) : (
              renderFileTree(files)
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </Box>
  )
}