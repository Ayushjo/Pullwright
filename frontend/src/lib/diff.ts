export type FileDiff = { path: string; status: 'A' | 'M' | 'D'; lines: string[]; added: number; removed: number; binary: boolean }

export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = []
  for (const part of patch.split(/^(?=diff --git )/m)) {
    const head = part.match(/^diff --git a\/(.+?) b\/(.+?)\n/)
    if (!head) continue
    const status: FileDiff['status'] = /^new file mode/m.test(part) ? 'A' : /^deleted file mode/m.test(part) ? 'D' : 'M'
    const body = part.slice(part.search(/^@@/m) >= 0 ? part.search(/^@@/m) : part.length)
    const lines = body ? body.replace(/\n$/, '').split('\n') : []
    files.push({
      path: status === 'D' ? head[1]! : head[2]!,
      status,
      lines,
      added: lines.filter((l) => l.startsWith('+')).length,
      removed: lines.filter((l) => l.startsWith('-')).length,
      binary: /^Binary files|GIT binary patch/m.test(part),
    })
  }
  return files
}

