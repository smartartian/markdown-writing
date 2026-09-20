export function expandDocumentParents(path, rootDir, expandedDirs) {
  if (!path || !rootDir || !expandedDirs) return expandedDirs;

  const separator = rootDir.includes('\\') ? '\\' : '/';
  const rootBoundary = rootDir.endsWith('/') || rootDir.endsWith('\\')
    ? rootDir
    : `${rootDir}${separator}`;
  let parent = path.replace(/[\\/][^\\/]+$/, '');

  while (parent && parent !== rootDir && parent.startsWith(rootBoundary)) {
    expandedDirs.add(parent);
    const nextParent = parent.replace(/[\\/][^\\/]+$/, '');
    if (nextParent === parent) break;
    parent = nextParent;
  }

  return expandedDirs;
}
