import { useFileStore } from '@/lib/file-store'

export function useFiles() {
  const files = useFileStore((state) => state.files)
  const openTabs = useFileStore((state) => state.openTabs)
  const activeTabId = useFileStore((state) => state.activeTabId)
  const compiledHtml = useFileStore((state) => state.compiledHtml)
  const pendingChange = useFileStore((state) => state.pendingChange)
  const pendingAIRequest = useFileStore((state) => state.pendingAIRequest)
  const openFile = useFileStore((state) => state.openFile)
  const closeTab = useFileStore((state) => state.closeTab)
  const setActiveTab = useFileStore((state) => state.setActiveTab)
  const updateFileContent = useFileStore((state) => state.updateFileContent)
  const updateFileContentWithDiff = useFileStore((state) => state.updateFileContentWithDiff)
  const setCompiledHtml = useFileStore((state) => state.setCompiledHtml)
  const getFileById = useFileStore((state) => state.getFileById)
  const getFileContent = useFileStore((state) => state.getFileContent)
  const setPendingChange = useFileStore((state) => state.setPendingChange)
  const acceptChange = useFileStore((state) => state.acceptChange)
  const rejectChange = useFileStore((state) => state.rejectChange)
  const requestAIFix = useFileStore((state) => state.requestAIFix)
  const clearAIRequest = useFileStore((state) => state.clearAIRequest)
  const resetToDefaults = useFileStore((state) => state.resetToDefaults)

  const activeFile = activeTabId ? getFileById(activeTabId) : null
  const activeContent = activeTabId ? getFileContent(activeTabId) : ''

  return {
    files,
    openTabs,
    activeTabId,
    activeFile,
    activeContent,
    compiledHtml,
    pendingChange,
    pendingAIRequest,
    openFile,
    closeTab,
    setActiveTab,
    updateFileContent,
    updateFileContentWithDiff,
    setCompiledHtml,
    getFileById,
    getFileContent,
    setPendingChange,
    acceptChange,
    rejectChange,
    requestAIFix,
    clearAIRequest,
    resetToDefaults,
  }
}
