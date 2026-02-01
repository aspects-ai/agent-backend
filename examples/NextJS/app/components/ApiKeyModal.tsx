'use client'

import {
  Alert,
  Anchor,
  Button,
  Modal,
  Stack,
  Text,
  TextInput
} from '@mantine/core'
import { IconAlertCircle, IconExternalLink, IconKey } from '@tabler/icons-react'
import { useState } from 'react'

interface ApiKeyModalProps {
  opened: boolean
  onSubmit: (apiKey: string) => void
}

export default function ApiKeyModal({ opened, onSubmit }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)

  const handleSubmit = async () => {
    if (!apiKey.trim()) return

    setIsValidating(true)

    // Pass to parent component (stored in React state only)
    onSubmit(apiKey.trim())
    setIsValidating(false)
  }

  return (
    <Modal
      opened={opened}
      onClose={() => { }}
      title="Welcome to the AgentBackend Codebuff demo!"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      size="md"
    >
      <Stack gap="md">
        <Text size="md" mb="xs">
          To get started, enter your Codebuff API key.
        </Text>

        <Alert
          icon={<IconAlertCircle size={16} />}
          color="blue"
          variant="light"
        >
          <Text size="sm">
            Your API key is kept in memory only during this session and sent directly to Codebuff's servers.
            It is never stored on our servers or in your browser storage.
          </Text>
        </Alert>

        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Get your API key from{' '}
            <Anchor
              href="https://codebuff.com"
              target="_blank"
              size="sm"
            >
              Codebuff
              <IconExternalLink size={12} style={{ marginLeft: 4 }} />
            </Anchor>
          </Text>

          <TextInput
            placeholder="Enter your Codebuff API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            leftSection={<IconKey size={16} />}
            type="password"
            size="md"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit()
              }
            }}
          />
        </Stack>

        <Button
          onClick={handleSubmit}
          disabled={!apiKey.trim()}
          loading={isValidating}
          size="md"
          fullWidth
        >
          Start Demo
        </Button>

        <Text size="xs" c="dimmed" ta="center">
          Your API key will only be kept in memory for this session.
          You'll need to re-enter it if you refresh the page.
        </Text>
      </Stack>
    </Modal>
  )
}