'use client'

import { Alert, Badge, Group, Text } from '@mantine/core'
import { IconDatabase, IconServer } from '@tabler/icons-react'

interface StatusBarProps {
  sessionId: string
  backendType: 'local' | 'remote'
}

export default function StatusBar({ sessionId, backendType }: StatusBarProps) {
  return (
    <Alert 
      icon={backendType === 'local' ? <IconDatabase size="1rem" /> : <IconServer size="1rem" />}
      color={backendType === 'local' ? 'blue' : 'green'}
      variant="light"
    >
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text size="sm" fw={500}>
            Backend: {backendType === 'local' ? 'Local Filesystem' : 'Remote SSH'}
          </Text>
          <Badge 
            color={backendType === 'local' ? 'blue' : 'green'} 
            variant="outline"
            size="sm"
          >
            {backendType.toUpperCase()}
          </Badge>
        </Group>
        
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">
            Session:
          </Text>
          <Text size="sm" ff="monospace" fw={500}>
            {sessionId}
          </Text>
        </Group>
      </Group>
    </Alert>
  )
}