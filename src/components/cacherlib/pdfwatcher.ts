import * as vscode from 'vscode'
import * as chokidar from 'chokidar'

import type {Extension} from '../../main'
import { Logger } from '../logger'

export class PdfWatcher {
    private readonly watchedPdfLocalPaths = new Set<string>()
    private pdfWatcher: chokidar.FSWatcher
    private readonly watchedPdfVirtualUris = new Set<string>()
    private readonly ignoredPdfUris = new Set<string>()

    constructor(private readonly extension: Extension) {
        this.pdfWatcher = chokidar.watch([], this.getWatcherOptions())
        this.initializeWatcher()
        this.initiateVirtualUriWatcher()

        this.extension.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('latex-workshop.latex.watch.usePolling') ||
                e.affectsConfiguration('latex-workshop.latex.watch.interval') ||
                e.affectsConfiguration('latex-workshop.latex.watch.pdf.delay')) {
                void this.pdfWatcher.close()
                this.pdfWatcher = chokidar.watch([], this.getWatcherOptions())
                this.watchedPdfLocalPaths.forEach(filePath => this.pdfWatcher.add(filePath))
                this.initializeWatcher()
            }
        }))
    }

    async dispose() {
        await this.pdfWatcher.close()
    }

    private toKey(pdfFileUri: vscode.Uri) {
        return pdfFileUri.toString(true)
    }

    private initializeWatcher() {
        this.pdfWatcher.on('change', (file: string) => this.onWatchedPdfChanged(file))
        this.pdfWatcher.on('unlink', (file: string) => this.onWatchedPdfDeleted(file))
    }

    private getWatcherOptions() {
        const configuration = vscode.workspace.getConfiguration('latex-workshop')
        return {
            useFsEvents: false,
            usePolling: configuration.get('latex.watch.usePolling') as boolean,
            interval: configuration.get('latex.watch.interval') as number,
            binaryInterval: Math.max(configuration.get('latex.watch.interval') as number, 1000),
            awaitWriteFinish: {stabilityThreshold: configuration.get('latex.watch.pdf.delay') as number}
        }
    }

    private isWatchedVirtualUri(pdfFile: vscode.Uri): boolean {
        if (this.extension.lwfs.isVirtualUri(pdfFile)) {
            const key = this.toKey(pdfFile)
            return this.watchedPdfVirtualUris.has(key)
        } else {
            return false
        }
    }

    private initiateVirtualUriWatcher() {
        const virtualUriWatcher = vscode.workspace.createFileSystemWatcher('**/*.{pdf,PDF}', false, false, true)
        const cb = (fileUri: vscode.Uri) => {
            if (this.isIgnored(fileUri)) {
                return
            }
            if (this.isWatchedVirtualUri(fileUri)) {
                this.extension.viewer.refreshExistingViewer()
            }
        }
        // It is recommended to react to both change and create events.
        // See https://github.com/microsoft/vscode/issues/136460#issuecomment-982605100
        virtualUriWatcher.onDidChange(cb)
        virtualUriWatcher.onDidCreate(cb)
        return virtualUriWatcher
    }

    private onWatchedPdfChanged(file: string) {
        if (this.isIgnored(file)) {
            return
        }
        Logger.log(`PDF file watcher - file changed: ${file}`)
        this.extension.viewer.refreshExistingViewer(undefined, file)
    }

    private onWatchedPdfDeleted(file: string) {
        Logger.log(`PDF file watcher - file deleted: ${file}`)
        this.pdfWatcher.unwatch(file)
        this.watchedPdfLocalPaths.delete(file)
    }

    watchPdfFile(pdfFileUri: vscode.Uri) {
        const isLocal = this.extension.lwfs.isLocalUri(pdfFileUri)
        if (isLocal) {
            const pdfFilePath = pdfFileUri.fsPath
            if (!this.watchedPdfLocalPaths.has(pdfFilePath)) {
                Logger.log(`Added to PDF file watcher: ${pdfFileUri.toString(true)}`)
                this.pdfWatcher.add(pdfFilePath)
                this.watchedPdfLocalPaths.add(pdfFilePath)
            }
        } else {
            this.watchedPdfVirtualUris.add(this.toKey(pdfFileUri))
        }
    }

    private isIgnored(pdfFile: vscode.Uri | string): boolean {
        let pdfFileUri: vscode.Uri
        if (typeof pdfFile === 'string') {
            pdfFileUri = vscode.Uri.file(pdfFile)
        } else {
            pdfFileUri = pdfFile
        }
        const key = this.toKey(pdfFileUri)
        return this.ignoredPdfUris.has(key)
    }

    ignorePdfFile(pdfFileUri: vscode.Uri) {
        this.ignoredPdfUris.add(this.toKey(pdfFileUri))
    }

    logWatchedFiles() {
        Logger.log(`PdfWatcher.pdfWatcher.getWatched: ${JSON.stringify(this.pdfWatcher.getWatched())}`)
        Logger.log(`PdfWatcher.pdfsWatched: ${JSON.stringify(Array.from(this.watchedPdfLocalPaths))}`)
        Logger.log(`PdfWatcher.watchedPdfVirtualUris: ${JSON.stringify(Array.from(this.watchedPdfVirtualUris))}`)
        Logger.log(`PdfWatcher.ignoredPdfUris: ${JSON.stringify(Array.from(this.ignoredPdfUris))}`)
    }

}
