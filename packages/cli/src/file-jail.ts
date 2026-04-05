import path from 'node:path'

/**
 * Resolve a file path within the project root.
 * Throws if the resolved path escapes the project boundary.
 */
export function resolveInProject(filePath: string, projectRoot: string): string {
  const resolved = path.resolve(projectRoot, filePath)
  const normalizedRoot = path.resolve(projectRoot) + path.sep

  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(projectRoot)) {
    throw new Error(`Path traversal blocked: ${filePath} resolves outside project root`)
  }

  return resolved
}

/**
 * Convert an absolute path to a path relative to the project root.
 */
export function toRelativePath(absolutePath: string, projectRoot: string): string {
  return path.relative(projectRoot, absolutePath)
}
