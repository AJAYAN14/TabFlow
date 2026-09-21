// JS for options.html

import {
    checkPerms,
    grantPerms,
    onAdded,
    onRemoved,
    saveOptions,
    showToast,
    updateManifest,
    updateOptions,
} from './export.js'

chrome.storage.onChanged.addListener(onChanged)
chrome.permissions.onAdded.addListener(onAdded)
chrome.permissions.onRemoved.addListener(onRemoved)

document.addEventListener('DOMContentLoaded', initOptions)
document.getElementById('add-host').addEventListener('submit', addHost)
document.getElementById('export-hosts').addEventListener('click', exportHosts)
document.getElementById('import-hosts').addEventListener('click', importHosts)
document.getElementById('copy-support').addEventListener('click', copySupport)
document
    .querySelectorAll('.grant-permissions')
    .forEach((el) => el.addEventListener('click', grantPerms))
document
    .querySelectorAll('#options-form input')
    .forEach((el) => el.addEventListener('change', saveOptions))
document
    .getElementById('options-form')
    .addEventListener('submit', (e) => e.preventDefault())
document
    .querySelectorAll('.open-oninstall')
    .forEach((el) => el.addEventListener('click', openOnInstall))
document
    .querySelectorAll('[data-bs-toggle="tooltip"]')
    .forEach((el) => new bootstrap.Tooltip(el))

const hostsInput = document.getElementById('hosts-input')
hostsInput.addEventListener('change', hostsInputChange)

/**
 * Initialize Options
 * @function initOptions
 */
async function initOptions() {
    console.debug('initOptions')
    updateManifest()
    await setShortcuts()
    await checkPerms()

    const { options, sites } = await chrome.storage.sync.get([
        'options',
        'sites',
    ])
    console.debug('options, sites:', options, sites)
    updateOptions(options)
    updateTable(sites)

    // 智能识别：输入框在粘贴/变动时立刻自动提取纯域名
    const hostNameInput = document.getElementById('host-name')
    if (hostNameInput && !hostNameInput.dataset.bound) {
        hostNameInput.dataset.bound = 'true'
        hostNameInput.addEventListener('paste', () => {
            setTimeout(() => {
                const cleaned = cleanDomain(hostNameInput.value)
                if (cleaned) hostNameInput.value = cleaned
            }, 10)
        })
        hostNameInput.addEventListener('change', () => {
            const cleaned = cleanDomain(hostNameInput.value)
            if (cleaned) hostNameInput.value = cleaned
        })
    }

    // 智能识别：一键从当前已打开的标签页添加
    await loadOpenTabs()
}

/**
 * On Changed Callback
 * @function onChanged
 * @param {Object} changes
 * @param {String} namespace
 */
function onChanged(changes, namespace) {
    // console.debug('onChanged:', changes, namespace)
    for (let [key, { newValue }] of Object.entries(changes)) {
        if (namespace === 'sync' && key === 'options') {
            updateOptions(newValue)
        }
        if (namespace === 'sync' && key === 'sites') {
            updateTable(newValue)
            loadOpenTabs()
        }
    }
}

/**
 * Update Popup Table with Data
 * @function updateTable
 * @param {Object} data
 */
function updateTable(data) {
    const tbody = document.querySelector('#hosts-table > tbody')
    tbody.innerHTML = ''

    data.forEach(function (value) {
        const row = tbody.insertRow()

        const deleteBtn = document.createElement('a')
        const svg = document
            .querySelector('.d-none > .fa-solid.fa-trash-can')
            .cloneNode(true)
        deleteBtn.appendChild(svg)
        deleteBtn.title = '删除'
        deleteBtn.dataset.value = value
        deleteBtn.classList.add('link-danger')
        deleteBtn.setAttribute('role', 'button')
        deleteBtn.addEventListener('click', deleteHost)
        const cell1 = row.insertCell()
        cell1.classList.add('text-center')
        cell1.appendChild(deleteBtn)

        const hostLink = document.createElement('a')
        hostLink.text = value
        hostLink.title = value
        hostLink.href = `https://${value}`
        hostLink.target = '_blank'
        hostLink.setAttribute('role', 'button')
        const cell2 = row.insertCell()
        cell2.classList.add('text-break')
        cell2.appendChild(hostLink)
    })
}

/**
 * 智能域名清洗与识别：
 * 无论粘贴完整网址（如 https://ke.qq.com/course/123?id=1）、无协议路径还是纯域名，
 * 均自动识别并提取出纯域名（如 ke.qq.com）
 */
function cleanDomain(input) {
    if (!input || typeof input !== 'string') return ''
    let val = input.trim()
    if (!val) return ''

    const urlMatch = val.match(/https?:\/\/[^\s/$.?#].[^\s]*/i)
    if (urlMatch) {
        val = urlMatch[0]
    }

    if (val.includes('://')) {
        try {
            return new URL(val).hostname.toLowerCase()
        } catch (_) {}
    }

    try {
        const u = new URL('https://' + val)
        return u.hostname.toLowerCase()
    } catch (_) {}

    const domainMatch = val.match(/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    return domainMatch ? domainMatch[1].toLowerCase() : val.toLowerCase()
}

/**
 * Add Host Callback
 * @function addHost
 * @param {SubmitEvent} event
 */
async function addHost(event) {
    console.debug('addHost:', event)
    event.preventDefault()
    const input = event.target.elements['host-name']
    const hostname = cleanDomain(input.value)

    if (!hostname || !hostname.includes('.')) {
        showToast('未能识别出有效的网站域名，请检查输入', 'danger')
        input.focus()
        input.select()
        return
    }

    console.log('Recognized domain:', hostname)
    const { sites = [] } = await chrome.storage.sync.get(['sites'])
    if (sites.includes(hostname)) {
        showToast(`主机已存在：${hostname}`, 'warning')
        input.focus()
        input.select()
        return
    } else {
        sites.push(hostname)
        await chrome.storage.sync.set({ sites })
        showToast(`已智能识别并添加：${hostname}`)
        input.value = ''
        input.focus()
    }
}

/**
 * Delete Host
 * @function deleteHost
 * @param {MouseEvent} event
 */
async function deleteHost(event) {
    console.debug('deleteHost:', event)
    event.preventDefault()
    const host = event.currentTarget?.dataset?.value
    console.info(`Delete Host: ${host}`)
    const { sites } = await chrome.storage.sync.get(['sites'])
    // console.debug('sites:', sites)
    if (host && sites.includes(host)) {
        const index = sites.indexOf(host)
        // console.debug(`index: ${index}`)
        if (index !== undefined) {
            sites.splice(index, 1)
            await chrome.storage.sync.set({ sites })
        }
    }
}

/**
 * Export Hosts Click Callback
 * @function exportHosts
 * @param {MouseEvent} event
 */
async function exportHosts(event) {
    console.debug('exportHosts:', event)
    event.preventDefault()
    const { sites } = await chrome.storage.sync.get(['sites'])
    console.debug('sites:', sites)
    if (!sites) {
        return showToast('未找到主机！', 'warning')
    }
    const json = JSON.stringify(sites, null, 2)
    textFileDownload('open-in-tab-sites.txt', json)
}

/**
 * Import Hosts Click Callback
 * @function importHosts
 * @param {MouseEvent} event
 */
async function importHosts(event) {
    console.debug('importHosts:', event)
    event.preventDefault()
    hostsInput.click()
}

/**
 * Hosts Input Change Callback
 * @function hostsInputChange
 * @param {InputEvent} event
 */
async function hostsInputChange(event) {
    console.debug('hostsInputChange:', event, hostsInput)
    event.preventDefault()
    const fileReader = new FileReader()
    fileReader.onload = async function doBannedImport() {
        const result = JSON.parse(fileReader.result.toString())
        console.debug('result:', result)
        const { sites } = await chrome.storage.sync.get(['sites'])
        let count = 0
        for (const pid of result) {
            if (!sites.includes(pid)) {
                sites.push(pid)
                count += 1
            }
        }
        showToast(`Imported ${count}/${result.length} Hosts.`, 'success')
        await chrome.storage.sync.set({ sites })
    }
    fileReader.readAsText(hostsInput.files[0])
}

/**
 * Text File Download
 * @function textFileDownload
 * @param {String} filename
 * @param {String} text
 */
function textFileDownload(filename, text) {
    console.debug(`textFileDownload: ${filename}`)
    const element = document.createElement('a')
    element.setAttribute(
        'href',
        'data:text/plain;charset=utf-8,' + encodeURIComponent(text)
    )
    element.setAttribute('download', filename)
    element.classList.add('d-none')
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
}

/**
 * Set Keyboard Shortcuts
 * @function setShortcuts
 * @param {String} selector
 */
async function setShortcuts(selector = '#keyboard-shortcuts-list') {
    const list = document.querySelector(selector)
    const template = list.querySelector('.template')
    const commands = await chrome.commands.getAll()
    for (const command of commands) {
        // console.debug('command:', command)
        const item = template.cloneNode(true)
        item.classList.remove('d-none', 'template')
        
        // TODO: Chrome does not parse the description for _execute_action in manifest.json
        let description = command.description
        if (!description && command.name === '_execute_action') {
            description = '显示弹出窗口'
        }
        item.querySelector('.description').textContent = description
        item.querySelector('.shortcut').textContent = command.shortcut || '未设置'
        list.appendChild(item)
    }
}

/**
 * Copy Support/Debugging Information
 * @function copySupport
 * @param {MouseEvent} event
 */
async function copySupport(event) {
    console.debug('copySupport:', event)
    event.preventDefault()
    const manifest = chrome.runtime.getManifest()
    const { options } = await chrome.storage.sync.get(['options'])
    const permissions = await chrome.permissions.getAll()
    const result = [
        `${manifest.name} - ${manifest.version}`,
        navigator.userAgent,
        `permissions.origins: ${JSON.stringify(permissions.origins)}`,
        `options: ${JSON.stringify(options)}`,
    ]
    await navigator.clipboard.writeText(result.join('\n'))
    showToast('支持信息已复制。')
}

/**
 * 智能读取浏览器中已打开的标签页，提供一键快捷添加
 */
async function loadOpenTabs() {
    const section = document.getElementById('quick-add-section')
    const container = document.getElementById('quick-add-tabs')
    if (!section || !container) return

    const refreshBtn = document.getElementById('refresh-tabs-btn')
    if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = 'true'
        refreshBtn.addEventListener('click', () => loadOpenTabs())
    }

    try {
        const tabs = await chrome.tabs.query({})
        const { sites = [] } = await chrome.storage.sync.get(['sites'])

        const uniqueTabs = new Map()
        tabs.forEach((tab) => {
            if (!tab.url) return
            try {
                const u = new URL(tab.url)
                if (
                    (u.protocol === 'http:' || u.protocol === 'https:') &&
                    !sites.includes(u.hostname)
                ) {
                    if (!uniqueTabs.has(u.hostname)) {
                        uniqueTabs.set(u.hostname, {
                            title: tab.title || u.hostname,
                            hostname: u.hostname,
                            favIconUrl: tab.favIconUrl,
                        })
                    }
                }
            } catch (_) {}
        })

        if (uniqueTabs.size === 0) {
            section.classList.add('d-none')
            return
        }

        container.innerHTML = ''
        uniqueTabs.forEach(({ title, hostname, favIconUrl }) => {
            const badge = document.createElement('button')
            badge.type = 'button'
            badge.className =
                'btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 text-truncate py-1 px-2'
            badge.style.maxWidth = '260px'
            badge.title = `点击一键添加：${hostname}\n(${title})`

            const icon = favIconUrl
                ? `<img src="${favIconUrl}" width="14" height="14" class="rounded-circle me-1" onerror="this.style.display='none'">`
                : `<i class="fa-solid fa-globe text-muted me-1 small"></i>`

            const shortTitle =
                title.length > 14 ? title.slice(0, 14) + '...' : title

            badge.innerHTML = `${icon}<span class="text-truncate">${shortTitle}</span><span class="badge bg-primary ms-1">+添加</span>`

            badge.addEventListener('click', async () => {
                const { sites: currentSites = [] } = await chrome.storage.sync.get(['sites'])
                if (!currentSites.includes(hostname)) {
                    currentSites.push(hostname)
                    await chrome.storage.sync.set({ sites: currentSites })
                    showToast(`已添加：${hostname}`)
                }
                badge.remove()
                if (container.children.length === 0) {
                    section.classList.add('d-none')
                }
            })

            container.appendChild(badge)
        })

        section.classList.remove('d-none')
    } catch (e) {
        console.warn('loadOpenTabs:', e)
        section.classList.add('d-none')
    }
}

