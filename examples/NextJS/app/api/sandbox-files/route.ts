import { NextRequest, NextResponse } from 'next/server';
import { createFileSystem, initAgentBackend } from '../../../lib/backends-init';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    console.log('Sandbox-files API: sessionId =', JSON.stringify(sessionId))

    // Initialize AgentBackend configuration
    initAgentBackend()

    // Create a new FileSystem instance each time to avoid caching issues
    const fs = createFileSystem(sessionId);

    // Get workspace
    const workspace = await fs.getWorkspace('default');

    // Log workspace path for debugging
    console.log('[sandbox-files] Workspace path:', workspace.workspacePath);

    // Get all files from the workspace
    const files: any[] = [];

    // Since we can't use cd or quotes, we'll use a simpler approach
    // First get all files and directories recursively
    async function getAllFiles() {
      // Helper function to process a single path
      async function processPath(filePath: string) {
        try {
          const statResult = await workspace.exec(`stat -c '%F' "${filePath}" || stat -f '%HT' "${filePath}"`);
          if (typeof statResult !== 'string') {
            throw new Error('Output is not a string')
          }
          const fileType = statResult.trim().toLowerCase();

          if (fileType.includes('regular file')) {
            const content = await workspace.readFile(filePath, 'utf-8');
            const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
            files.push({ path: normalizedPath, content });
            console.log('[sandbox-files] Added file:', normalizedPath);
          } else {
            console.debug(`[sandbox-files] Skipping ${filePath}: not a regular file (${fileType})`);
          }
        } catch (err) {
          console.debug(`[sandbox-files] Skipping ${filePath}:`, err);
        }
      }

      try {
        // Try using ls -R to get recursive listing
        let lsResult: string | Buffer = '';
        try {
          lsResult = await workspace.exec('ls -R');
        } catch (err) {
          console.log('[sandbox-files] ls -R failed, falling back to simple ls:', err);
          // Fall back to simple ls if recursive doesn't work
          lsResult = await workspace.exec('ls');
        }

        if (typeof lsResult !== 'string' || !lsResult.trim()) {
          console.log('[sandbox-files] No files found');
          return;
        }

        // Parse ls -R output
        if (lsResult.includes(':')) {
          // This is recursive ls output
          const sections = lsResult.split(/\n\n/);
          let currentDir = '';

          for (const section of sections) {
            const lines = section.split('\n').filter(Boolean);

            for (const line of lines) {
              // Check if this line indicates a directory
              if (line.endsWith(':')) {
                currentDir = line.slice(0, -1).replace(/^\.\/?/, '');
                // Skip node_modules directory entirely
                if (currentDir.includes('node_modules')) {
                  currentDir = 'SKIP';
                }
                continue;
              }

              // Skip if we're in a directory we want to skip
              if (currentDir === 'SKIP') {
                continue;
              }

              // Skip empty lines and special entries
              if (!line || line === '.' || line === '..' || line.startsWith('.')) {
                continue;
              }

              // Skip node_modules
              if (line.includes('node_modules')) {
                continue;
              }

              // Build the full path
              const fullPath = currentDir ? `${currentDir}/${line}` : line;
              await processPath(fullPath);
            }
          }
        } else {
          // Simple ls output - just top-level files
          const fileNames = lsResult.split('\n').filter(Boolean);

          for (const fileName of fileNames) {
            if (!fileName || fileName.includes('node_modules')) {
              continue;
            }

            await processPath(fileName);
          }
        }
      } catch (err) {
        console.log('[sandbox-files] Error getting files:', err);
      }
    }

    try {
      await getAllFiles();
    } catch (err) {
      console.log('[sandbox-files] Failed to get files:', err);
    }

    console.log('[sandbox-files] Returning', files.length, 'files');

    return NextResponse.json({ files }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('Failed to fetch sandbox files:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}