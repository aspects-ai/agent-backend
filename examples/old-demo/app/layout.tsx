import '@mantine/code-highlight/styles.css'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import '@mantine/dropzone/styles.css'
import { Notifications } from '@mantine/notifications'
import '@mantine/notifications/styles.css'
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AgentBackend Demo',
  description: 'Interactive AI coding assistant powered by AgentBackend',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <MantineProvider
          defaultColorScheme="dark"
          theme={{
            primaryColor: 'blue',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
            headings: {
              fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
            },
          }}
        >
          <Notifications />
          {children}
        </MantineProvider>
      </body>
    </html>
  )
}