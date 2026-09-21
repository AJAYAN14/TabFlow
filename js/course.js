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

        // 智能自动呈现：进入网页后，自动展开所属期数并将具体在学课时（如第30集）直接呈现在屏幕正中间
        setTimeout(function () {
            locateActiveLesson(true)
        }, 800)
    }

    /**
     * Detect whether the current page is a course platform page.
     * Checks for domain, course list elements (.schedule-name, .live-item, or percentage text)
     */
    function detectCoursePage() {
        if (location.hostname.includes('xinqingchen') || location.pathname.includes('courseDetail')) {
            return true
        }
        var hasSchedule = document.querySelector('.schedule-name') !== null
        var hasLiveItem = document.querySelector('.live-item') !== null
        var hasHeader = document.querySelector('.live-header') !== null
        var hasRight = document.querySelector('.right') !== null
        return (hasSchedule && hasLiveItem) || (hasLiveItem && hasHeader) || (hasSchedule && hasHeader) || (hasRight && hasLiveItem)
    }

    // ─── Scan & Render ───────────────────────────────────────

    /**
     * Find elements containing progress percentage.
     */
    function findProgressElements() {
        var rights = Array.from(document.querySelectorAll('.right'))
        if (rights.length > 0) return rights

        var list = []
        document.querySelectorAll('.live-item, .schedule-name, div, span, p, li').forEach(function (el) {
            if (el.children.length === 0 && /(\d+)%/.test(el.innerText || '')) {
                if (!el.closest('#tf-floating-panel')) {
                    list.push(el)
                }
            }
        })
        return list
    }

    /**
     * Walk every progress element, parse the percentage, inject visual badges
     * and tint the parent row. Returns aggregated stats.
     */
    function scanAndRender() {
        const stats = { total: 0, done: 0, doing: 0, todo: 0, firstDoingEl: null }

        findProgressElements().forEach(function (rightEl) {
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
            locateActiveLesson(false)
        })

        document.getElementById('tf-btn-last').addEventListener('click', function () {
            locateActiveLesson(false)
        })

        document.getElementById('tf-btn-filter').addEventListener('click', function () {
            filterActive = !filterActive
            toggleFilter(filterActive)
            this.textContent = filterActive ? '👁 显示全部课程' : '🔍 只看未学完'
            this.classList.toggle('tf-active', filterActive)
        })
    }

    // ─── Navigation & Precise Centering ───────────────────────

    /**
     * 自动智能定位并居中呈现具体课时（例如第30集）
     */
    function locateActiveLesson(isAuto) {
        findActiveLesson(function (target) {
            if (!target || !target.element) {
                if (!isAuto) showTip('未检测到进行中的课程')
                return
            }

            var lessonEl = target.element
            var periodItem = target.periodItem || lessonEl.closest('.live-item')

            function doScroll() {
                // 平滑滚动并直接居中在屏幕正中央！
                lessonEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

                // 醒目的呼吸灯/脉冲高亮动画
                lessonEl.classList.remove('tf-highlight')
                void lessonEl.offsetWidth
                lessonEl.classList.add('tf-highlight')

                // 标注“📌 当前在看”图钉
                addCurrentWatchingMarker(lessonEl)

                var title = getLessonTitle(lessonEl)
                if (!isAuto) {
                    showTip('已居中定位到：' + (title || '当前学习集数'))
                }
            }

            // 如果所属期数处于折叠状态，先自动点击展开期数
            if (periodItem && !isPeriodExpanded(periodItem)) {
                var header = periodItem.querySelector('.live-header') || periodItem
                header.click()
                setTimeout(doScroll, 350)
            } else {
                doScroll()
            }
        })
    }

    /**
     * 智能寻找当前正在学习的课时：
     * 1. 优先使用本地记录（用户最后点击看的那一集）
     * 2. 否则从下往上倒序扫描，找到进度在 1% ~ 95% 之间的最前沿集数（例如第30集 17%）
     * 3. 降级：找第一集 0% 未学习的
     */
    function findActiveLesson(callback) {
        chrome.storage.local.get([STORAGE_KEY], function (data) {
            var last = data[STORAGE_KEY]
            if (last && last.lesson) {
                var storedEl = findLessonElement(last.lesson)
                if (storedEl) {
                    var periodEl = storedEl.closest('.live-item')
                    callback({ element: storedEl, periodItem: periodEl, title: last.lesson })
                    return
                }
            }

            // 倒序寻找进度在 1% ~ 95% 之间的最后一课（最前沿进度，如第30集）
            var progressElements = findProgressElements()
            var candidates = []

            progressElements.forEach(function (el) {
                var text = el.innerText || ''
                var match = text.match(/(\d+)%/)
                if (match) {
                    var percent = parseInt(match[1], 10)
                    var lessonRow = getLessonContainer(el)
                    candidates.push({
                        element: lessonRow || el,
                        percent: percent,
                        periodItem: el.closest('.live-item')
                    })
                }
            })

            // 倒序找最后一个在学中的（0 < percent <= 95）
            for (var i = candidates.length - 1; i >= 0; i--) {
                if (candidates[i].percent > 0 && candidates[i].percent <= 95) {
                    callback(candidates[i])
                    return
                }
            }

            // 降级：找第一个 0% 未学习的
            for (var j = 0; j < candidates.length; j++) {
                if (candidates[j].percent === 0) {
                    callback(candidates[j])
                    return
                }
            }

            callback(candidates[0] || null)
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

            var lessonEl = findLessonElement(last.lesson)
            if (lessonEl) {
                addCurrentWatchingMarker(lessonEl)
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
            if (target.closest('#tf-floating-panel')) return

            // Match if user clicks on .schedule-name, video icon, or anywhere in the lesson row
            var sName = target.closest('.schedule-name')
            if (!sName) {
                var container = getLessonContainer(target)
                if (container) {
                    sName = container.querySelector('.schedule-name')
                }
            }

            if (sName) {
                var lessonTitle = (sName.innerText || '').trim()
                var periodItem = target.closest('.live-item')
                var headerEl = periodItem ? periodItem.querySelector('.live-header .title, .live-header') : null
                var periodTitle = headerEl ? (headerEl.innerText || '').trim() : ''
                if (lessonTitle) {
                    saveLastViewed(periodTitle, lessonTitle)
                    console.log('[TabFlow] 记录学习点击:', periodTitle, lessonTitle)
                }
            }
        }, true)
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
     * 获取课时的独立行容器（防止取到包含几十节课的外层 .live-item 期数大容器）
     */
    function getLessonContainer(el) {
        if (!el) return null
        var scheduleName = el.classList && el.classList.contains('schedule-name') ? el : el.querySelector('.schedule-name')
        var base = scheduleName || el

        var current = base
        while (current && current.parentElement) {
            if (current.parentElement.classList.contains('live-item')) {
                if (!current.classList.contains('live-header')) {
                    return current
                }
            }
            current = current.parentElement
        }

        return base.parentElement || base
    }

    function getLessonTitle(el) {
        if (!el) return ''
        var nameEl = el.querySelector('.schedule-name') || el
        return (nameEl.innerText || '').split('\n')[0].trim()
    }

    function findLessonElement(title) {
        var names = document.querySelectorAll('.schedule-name')
        for (var i = 0; i < names.length; i++) {
            var text = (names[i].innerText || '').trim()
            if (text === title || text.includes(title) || title.includes(text)) {
                return getLessonContainer(names[i]) || names[i]
            }
        }
        return null
    }

    function addCurrentWatchingMarker(lessonEl) {
        document.querySelectorAll('.tf-last-viewed-marker').forEach(function (m) { m.remove() })
        var marker = document.createElement('span')
        marker.className = 'tf-last-viewed-marker'
        marker.textContent = '📌 当前在看'

        var nameEl = lessonEl.querySelector('.schedule-name') || lessonEl
        nameEl.appendChild(marker)
    }

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
        return findLessonElement(title)
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
