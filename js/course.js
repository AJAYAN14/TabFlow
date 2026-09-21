// JS Content Script — course.js
// TabFlow Course Progress Enhancer
// Fully self-contained: no imports, no jQuery, no Bootstrap dependency.
// Activates only on pages that match the course platform's DOM fingerprint.

;(function TabFlowCourseEnhancer() {
    'use strict'

    // ─── Constants ───────────────────────────────────────────
    const STORAGE_KEY = 'tf_course_last'
    const DEBOUNCE_MS = 300
    const HIGHLIGHT_MS = 2000
    const SCROLL_DELAY_MS = 350
    // Feature-detection selectors (all three must exist to activate)
    const FINGERPRINT_SELECTORS = ['.live-item', '.schedule-name', '.live-header']

    // ─── Options Gate & Feature Detection ────────────────────
    chrome.storage.sync.get(['options'], function (res) {
        var opts = res && res.options ? res.options : {}
        if (opts.enableCourseEnhancer === false) {
            console.log('[TabFlow] 视频学习进度增强已在设置中关闭。')
            return
        }
        startEnhancer()
    })

    // Listen for options changes dynamically
    if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'sync' && changes.options) {
                var newOpts = changes.options.newValue || {}
                if (newOpts.enableCourseEnhancer === false) {
                    teardownEnhancer()
                } else if (newOpts.enableCourseEnhancer === true) {
                    startEnhancer()
                }
            }
        })
    }

    function startEnhancer() {
        if (detectCoursePage()) {
            console.log('[TabFlow] 🎓 Course page detected. Activating progress enhancer.')
            init()
        } else {
            // Check asynchronously if DOM loads dynamically (SPA / Ajax)
            var attempts = 0
            var checkInterval = setInterval(function () {
                attempts++
                if (detectCoursePage()) {
                    clearInterval(checkInterval)
                    console.log('[TabFlow] 🎓 Course page detected via async check.')
                    init()
                } else if (attempts >= 15) {
                    clearInterval(checkInterval)
                }
            }, 500)
        }
    }

    function teardownEnhancer() {
        var p = document.getElementById('tf-floating-panel')
        if (p) p.remove()
        document.querySelectorAll('.tf-badge, .tf-last-viewed-marker').forEach(function (el) { el.remove() })
        document.querySelectorAll('.tf-row-done, .tf-row-doing').forEach(function (el) {
            el.classList.remove('tf-row-done', 'tf-row-doing')
        })
    }

    // ─── State ───────────────────────────────────────────────
    let filterActive = false
    let panelMinimized = false
    let initialized = false

    // ─── Bootstrap ───────────────────────────────────────────
    function init() {
        if (initialized) return
        initialized = true
        const stats = scanAndRender()
        buildPanel(stats)
        restoreLastViewed()
        observeDOM()
        interceptLessonClicks()
    }

    /**
     * Detect whether the current page is a course platform page.
     * Checks for course list elements (.schedule-name, .live-item, or percentage text)
     */
    function detectCoursePage() {
        var hasSchedule = document.querySelector('.schedule-name') !== null
        var hasLiveItem = document.querySelector('.live-item') !== null
        var hasHeader = document.querySelector('.live-header') !== null
        return (hasSchedule && hasLiveItem) || (hasLiveItem && hasHeader) || (hasSchedule && hasHeader)
    }

    // ─── Scan & Render ───────────────────────────────────────

    /**
     * Walk every div.right, parse the percentage, inject visual badges
     * and tint the parent row. Returns aggregated stats.
     */
    function scanAndRender() {
        const stats = { total: 0, done: 0, doing: 0, todo: 0, firstDoingEl: null }

        document.querySelectorAll('.right').forEach(function (rightEl) {
            const text = rightEl.innerText || ''
            const match = text.match(/(\d+)%/)
            if (!match) return

            stats.total++
            var percent = parseInt(match[1], 10)

            // Find the closest meaningful parent row for background tinting
            var row = rightEl.closest('.live-item') || rightEl.parentElement

            // Remove old badges (idempotent re-render)
            rightEl.querySelectorAll('.tf-badge').forEach(function (b) { b.remove() })
            // Remove old row classes
            if (row) {
                row.classList.remove('tf-row-done', 'tf-row-doing')
            }

            var badge = document.createElement('span')
            badge.className = 'tf-badge'

            // 大于95%即判定为已看完（显示绿色高亮标签）
            if (percent > 95) {
                stats.done++
                badge.classList.add('tf-badge-done')
                badge.textContent = percent === 100 ? '✅ 已看完' : '✅ ' + percent + '% 已看完'
                if (row) row.classList.add('tf-row-done')
            } else if (percent > 0) {
                stats.doing++
                badge.classList.add('tf-badge-doing')
                badge.textContent = '⏳ ' + percent + '% 学习中'
                if (row) row.classList.add('tf-row-doing')
                if (!stats.firstDoingEl) {
                    stats.firstDoingEl = row || rightEl
                }
            } else {
                stats.todo++
                badge.classList.add('tf-badge-todo')
                badge.textContent = '⚪ 未学习'
            }

            rightEl.appendChild(badge)
        })

        console.log('[TabFlow] Scan complete:', stats)
        return stats
    }

    // ─── Floating Panel ──────────────────────────────────────

    /**
     * Create or update the floating control panel in the bottom-right corner.
     */
    function buildPanel(stats) {
        var panel = document.getElementById('tf-floating-panel')
        if (!panel) {
            panel = document.createElement('div')
            panel.id = 'tf-floating-panel'
            document.body.appendChild(panel)
            makeDraggable(panel)
        }

        var completionPct = stats.total > 0
            ? Math.round((stats.done / stats.total) * 100)
            : 0

        panel.innerHTML =
            '<div class="tf-panel-header">' +
                '<span>🎯 学习助手</span>' +
                '<span>' +
                    '<button class="tf-minimize-btn" id="tf-minimize-btn" title="最小化/展开">' +
                        (panelMinimized ? '▢' : '—') +
                    '</button>' +
                    '<span class="tf-brand"> TabFlow</span>' +
                '</span>' +
            '</div>' +
            '<div class="tf-panel-body">' +
                '<div class="tf-stats">' +
                    '已看: <b>' + stats.done + '</b>　' +
                    '学习中: <b class="tf-doing-count">' + stats.doing + '</b>　' +
                    '未看: <b class="tf-todo-count">' + stats.todo + '</b>　' +
                    '总计: <b>' + stats.total + '</b>' +
                '</div>' +
                '<div class="tf-progress-bar-wrap">' +
                    '<div class="tf-progress-bar-fill" style="width:' + completionPct + '%"></div>' +
                '</div>' +
                '<div class="tf-stats" style="font-size:11px; text-align:right; color:#94a3b8;">' +
                    '总进度 ' + completionPct + '%' +
                '</div>' +
                '<button class="tf-btn tf-btn-primary" id="tf-btn-jump">' +
                    '📍 定位到正在看的进度' +
                '</button>' +
                '<button class="tf-btn tf-btn-secondary" id="tf-btn-last">' +
                    '📂 展开上次学习的期数' +
                '</button>' +
                '<button class="tf-btn tf-btn-filter" id="tf-btn-filter">' +
                    (filterActive ? '👁 显示全部课程' : '🔍 只看未学完') +
                '</button>' +
            '</div>'

        // Restore minimized state
        if (panelMinimized) {
            panel.classList.add('tf-minimized')
        } else {
            panel.classList.remove('tf-minimized')
        }

        // Bind events
        document.getElementById('tf-minimize-btn').addEventListener('click', function (e) {
            e.stopPropagation()
            panelMinimized = !panelMinimized
            panel.classList.toggle('tf-minimized', panelMinimized)
            this.textContent = panelMinimized ? '▢' : '—'
        })

        document.getElementById('tf-btn-jump').addEventListener('click', function () {
            navigateToInProgress(stats)
        })

        document.getElementById('tf-btn-last').addEventListener('click', function () {
            jumpToLastViewed()
        })

        document.getElementById('tf-btn-filter').addEventListener('click', function () {
            filterActive = !filterActive
            toggleFilter(filterActive)
            this.textContent = filterActive ? '👁 显示全部课程' : '🔍 只看未学完'
            this.classList.toggle('tf-active', filterActive)
        })
    }

    // ─── Navigation ──────────────────────────────────────────

    /**
     * Scroll to the first lesson that is "in progress" (1%–99%).
     */
    function navigateToInProgress(stats) {
        // Re-scan to get fresh firstDoingEl
        var freshStats = scanAndRender()
        var target = freshStats.firstDoingEl
        if (target) {
            highlightAndScroll(target)
        } else {
            // Fallback: find the first 0% lesson (first unwatched)
            var firstTodo = findFirstTodoElement()
            if (firstTodo) {
                highlightAndScroll(firstTodo)
            } else {
                showTip('所有课程都已看完！🎉')
            }
        }
    }

    /**
     * Read stored last-viewed info, expand the target period,
     * and scroll to the target lesson.
     */
    function jumpToLastViewed() {
        chrome.storage.local.get([STORAGE_KEY], function (data) {
            var last = data[STORAGE_KEY]
            if (!last || !last.period) {
                showTip('暂无上次学习记录，请先点击"进入学习"开始一节课。')
                return
            }

            console.log('[TabFlow] Jumping to last viewed:', last)

            // 1. Find and expand the target period
            expandPeriod(last.period, function () {
                // 2. After expanding, find the lesson row and scroll to it
                if (last.lesson) {
                    var lessonEl = findLessonByTitle(last.lesson)
                    if (lessonEl) {
                        highlightAndScroll(lessonEl)
                        return
                    }
                }
                // Fallback: just scroll to the period header
                var header = findPeriodHeader(last.period)
                if (header) {
                    highlightAndScroll(header)
                }
            })
        })
    }

    /**
     * On page load, check if there's a stored last-viewed record
     * and add a small marker badge on that lesson row.
     */
    function restoreLastViewed() {
        chrome.storage.local.get([STORAGE_KEY], function (data) {
            var last = data[STORAGE_KEY]
            if (!last || !last.lesson) return

            var lessonEl = findLessonByTitle(last.lesson)
            if (lessonEl) {
                // Remove any existing markers
                document.querySelectorAll('.tf-last-viewed-marker').forEach(function (m) { m.remove() })

                var marker = document.createElement('span')
                marker.className = 'tf-last-viewed-marker'
                marker.textContent = '📌 上次在看'

                // Try to append to the schedule-name inside this row
                var nameEl = lessonEl.querySelector('.schedule-name')
                if (nameEl) {
                    nameEl.appendChild(marker)
                } else {
                    lessonEl.appendChild(marker)
                }
            }
        })
    }

    // ─── Period Fold/Unfold ──────────────────────────────────

    /**
     * Expand a specific period (by partial title match) and collapse others.
     * Uses simulated clicks on .live-header to respect the site's framework state.
     */
    function expandPeriod(periodTitle, callback) {
        var headers = document.querySelectorAll('.live-header')
        var targetHeader = null
        var targetItem = null

        headers.forEach(function (header) {
            var text = (header.innerText || '').trim()
            var liveItem = header.closest('.live-item')

            if (text.includes(periodTitle) || periodTitle.includes(text)) {
                targetHeader = header
                targetItem = liveItem
            }
        })

        if (!targetHeader) {
            showTip('未找到期数: ' + periodTitle)
            if (callback) callback()
            return
        }

        // Strategy: Click all OTHER expanded periods to collapse them,
        // then click the target period if it's collapsed.

        // First, collapse other periods
        headers.forEach(function (header) {
            if (header === targetHeader) return
            var liveItem = header.closest('.live-item')
            if (liveItem && isPeriodExpanded(liveItem)) {
                header.click()
            }
        })

        // Then expand target if collapsed
        if (targetItem && !isPeriodExpanded(targetItem)) {
            targetHeader.click()
        }

        // Wait for DOM to update after clicks, then invoke callback
        setTimeout(function () {
            targetHeader.scrollIntoView({ behavior: 'smooth', block: 'start' })
            if (callback) callback()
        }, SCROLL_DELAY_MS)
    }

    /**
     * Heuristic to check if a .live-item period section is currently expanded.
     * Looks for visible lesson children (div.right or any content block).
     */
    function isPeriodExpanded(liveItem) {
        // Check if the item has visible lesson rows beneath its header
        var lessons = liveItem.querySelectorAll('.right, .schedule-name')
        if (lessons.length === 0) return false

        // Check if at least one lesson is visible
        for (var i = 0; i < lessons.length; i++) {
            var rect = lessons[i].getBoundingClientRect()
            var style = window.getComputedStyle(lessons[i])
            if (style.display !== 'none' && rect.height > 0) {
                return true
            }
        }
        return false
    }

    // ─── Filter ──────────────────────────────────────────────

    /**
     * Toggle visibility: hide/show lessons that are 100% complete.
     */
    function toggleFilter(showOnlyIncomplete) {
        document.querySelectorAll('.right').forEach(function (rightEl) {
            var text = rightEl.innerText || ''
            var match = text.match(/(\d+)%/)
            if (!match) return

            var percent = parseInt(match[1], 10)
            var row = rightEl.closest('.live-item') || rightEl.parentElement

            // We want to hide individual lesson rows, not entire periods.
            // The row to toggle is the direct parent that contains this lesson entry.
            var lessonRow = rightEl.parentElement
            if (!lessonRow) return

            if (showOnlyIncomplete && percent > 95) {
                lessonRow.classList.add('tf-hidden')
            } else {
                lessonRow.classList.remove('tf-hidden')
            }
        })

        // Re-scan to update stats in the panel
        var stats = scanAndRender()
        buildPanel(stats)
    }

    // ─── Intercept "进入学习" Clicks ─────────────────────────

    /**
     * Listen for clicks on "进入学习" buttons to record
     * which period + lesson the user is about to watch.
     */
    function interceptLessonClicks() {
        document.addEventListener('click', function (e) {
            var target = e.target
            if (!target) return

            // Match the "进入学习" button (or a link/button containing that text)
            var btn = target.closest('button, a, [class*="btn"]')
            if (!btn) return

            var btnText = (btn.innerText || '').trim()
            if (btnText !== '进入学习') return

            // Walk up to find the lesson context
            var lessonContext = extractLessonContext(btn)
            if (lessonContext) {
                saveLastViewed(lessonContext.period, lessonContext.lesson)
            }
        }, true) // capture phase to run before navigation
    }

    /**
     * Given a button element, walk up the DOM to extract
     * the period title and lesson name.
     */
    function extractLessonContext(btn) {
        var result = { period: '', lesson: '' }

        // Find lesson name: look for .schedule-name in the same row
        var row = btn.closest('[class]')
        // Walk up trying to find a container with .schedule-name
        var current = btn.parentElement
        for (var i = 0; i < 8 && current; i++) {
            var nameEl = current.querySelector('.schedule-name')
            if (nameEl) {
                result.lesson = nameEl.innerText.trim()
                break
            }
            current = current.parentElement
        }

        // Find period title: look for the closest .live-item ancestor's .live-header
        var liveItem = btn.closest('.live-item')
        if (liveItem) {
            var headerEl = liveItem.querySelector('.live-header .title, .live-header')
            if (headerEl) {
                result.period = headerEl.innerText.trim()
            }
        }

        if (!result.lesson && !result.period) return null
        return result
    }

    // ─── Storage ─────────────────────────────────────────────

    /**
     * Persist the last-viewed period and lesson.
     */
    function saveLastViewed(period, lesson) {
        var data = {}
        data[STORAGE_KEY] = {
            period: period,
            lesson: lesson,
            timestamp: Date.now()
        }
        chrome.storage.local.set(data, function () {
            console.log('[TabFlow] Saved last viewed:', data[STORAGE_KEY])
        })
    }

    // ─── DOM Observation ─────────────────────────────────────

    /**
     * Watch for DOM mutations in the course list container
     * and re-render badges when content changes.
     */
    function observeDOM() {
        // Find the best container to observe.
        // Prefer a parent of .live-item elements to limit scope.
        var firstLiveItem = document.querySelector('.live-item')
        var container = (firstLiveItem && firstLiveItem.parentElement) || document.body

        var timeout = null
        var observer = new MutationObserver(function () {
            // Debounce: only re-render after mutations settle
            clearTimeout(timeout)
            timeout = setTimeout(function () {
                var stats = scanAndRender()
                buildPanel(stats)
                restoreLastViewed()
            }, DEBOUNCE_MS)
        })

        observer.observe(container, {
            childList: true,
            subtree: true
        })

        console.log('[TabFlow] MutationObserver attached to:', container.tagName, container.className)
    }

    // ─── Helpers ─────────────────────────────────────────────

    /**
     * Smooth-scroll to an element and apply a highlight pulse.
     */
    function highlightAndScroll(el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('tf-highlight')
        setTimeout(function () {
            el.classList.remove('tf-highlight')
        }, HIGHLIGHT_MS)
    }

    /**
     * Find a lesson row by partial title match in .schedule-name elements.
     */
    function findLessonByTitle(title) {
        var names = document.querySelectorAll('.schedule-name')
        for (var i = 0; i < names.length; i++) {
            var text = (names[i].innerText || '').trim()
            if (text === title || text.includes(title) || title.includes(text)) {
                return names[i].closest('.live-item') || names[i].parentElement || names[i]
            }
        }
        return null
    }

    /**
     * Find a period header by partial title match.
     */
    function findPeriodHeader(periodTitle) {
        var headers = document.querySelectorAll('.live-header')
        for (var i = 0; i < headers.length; i++) {
            var text = (headers[i].innerText || '').trim()
            if (text.includes(periodTitle) || periodTitle.includes(text)) {
                return headers[i]
            }
        }
        return null
    }

    /**
     * Find the first lesson row with 0% progress.
     */
    function findFirstTodoElement() {
        var rights = document.querySelectorAll('.right')
        for (var i = 0; i < rights.length; i++) {
            var text = rights[i].innerText || ''
            var match = text.match(/(\d+)%/)
            if (match && parseInt(match[1], 10) === 0) {
                return rights[i].closest('.live-item') || rights[i].parentElement
            }
        }
        return null
    }

    /**
     * Show a brief, non-intrusive notification tip on the panel.
     */
    function showTip(message) {
        var panel = document.getElementById('tf-floating-panel')
        if (!panel) return

        var tip = document.createElement('div')
        tip.style.cssText =
            'background:#fef3c7; color:#92400e; padding:8px 12px; border-radius:8px;' +
            'font-size:12px; font-weight:500; margin-top:4px; text-align:center;' +
            'transition:opacity 0.3s;'
        tip.textContent = message
        panel.appendChild(tip)

        setTimeout(function () {
            tip.style.opacity = '0'
            setTimeout(function () { tip.remove() }, 300)
        }, 3000)
    }

    /**
     * Make the floating panel draggable by its header area.
     */
    function makeDraggable(panel) {
        var isDragging = false
        var startX, startY, startRight, startBottom

        panel.addEventListener('mousedown', function (e) {
            // Only drag from header area, not from buttons
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return

            isDragging = true
            startX = e.clientX
            startY = e.clientY
            var rect = panel.getBoundingClientRect()
            startRight = window.innerWidth - rect.right
            startBottom = window.innerHeight - rect.bottom
            panel.classList.add('tf-dragging')
            e.preventDefault()
        })

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return
            var dx = e.clientX - startX
            var dy = e.clientY - startY

            var newRight = Math.max(0, startRight - dx)
            var newBottom = Math.max(0, startBottom - dy)

            // Prevent going off-screen
            newRight = Math.min(newRight, window.innerWidth - 100)
            newBottom = Math.min(newBottom, window.innerHeight - 50)

            panel.style.right = newRight + 'px'
            panel.style.bottom = newBottom + 'px'
        })

        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false
                panel.classList.remove('tf-dragging')
            }
        })
    }

})()
