/*!
 * src/tooltip.js — info-bulle de la frise (seul module qui touche au DOM
 * uniquement pour le positionnement).
 *
 * Le contenu HTML vient de `tooltipLines()` (chrono-view.js), donc il reste
 * testable sans navigateur.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      Object.assign(
        {},
        require('./constants.js'),
        require('./format.js'),
        require('./chrono-view.js')
      )
    )
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory(root.Workly))
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict'

  const LABELS = W.LABELS
  const tooltipLines = W.tooltipLines

  /** Marge (px) entre l'info-bulle et le bord de la fenêtre. */
  const EDGE = 8
  /** Décalage (px) entre le curseur et l'info-bulle. */
  const OFFSET = 14

  /** Lit un segment de frise depuis les data-* de son nœud. */
  function segmentFromNode(node) {
    return {
      type: node.dataset.type === 'break' ? 'break' : 'work',
      startTime: Number(node.dataset.start),
      endTime: Number(node.dataset.end),
      duration: Number(node.dataset.duration),
      total: Number(node.dataset.total) || 0,
      isLive: node.dataset.live === 'true',
      index: Number(node.dataset.index)
    }
  }

  class ChronoTooltip {
    /**
     * @param {HTMLElement} el nœud de l'info-bulle (#chronoTooltip)
     * @param {{doc?:Document, now?:function():number}} [options]
     */
    constructor(el, options) {
      const opts = options || {}
      this.el = el || null
      this.doc = opts.doc || (typeof document !== 'undefined' ? document : null)
      this.now = typeof opts.now === 'function' ? opts.now : function () { return Date.now() }
      this.index = null
    }

    get isOpen() {
      return Boolean(this.el) && !this.el.hidden
    }

    /** Contenu de l'info-bulle pour un nœud de segment. */
    contentFor(node) {
      const seg = segmentFromNode(node)
      const head =
        `<div class="tip-head ${seg.type === 'break' ? 'break' : 'work'}">${
          seg.type === 'break' ? LABELS.break : LABELS.work
        }${seg.isLive ? ' · running' : ''}</div>`
      return head + tooltipLines(seg, this.now())
    }

    update(node) {
      if (!this.el || !node) return
      this.index = segmentFromNode(node).index
      this.el.innerHTML = this.contentFor(node)
    }

    /** Ouvre l'info-bulle. `event` optionnel : sinon ancrage sous le segment. */
    show(node, event) {
      if (!this.el || !node) return
      this.update(node)
      this.el.hidden = false
      this.el.classList.add('visible')
      if (event && event.clientX !== undefined && event.type !== 'focusin') {
        this.move(event)
        return
      }
      const view = this.doc && this.doc.defaultView
      if (!view) return
      const rect = node.getBoundingClientRect()
      const width = this.el.offsetWidth || 200
      const maxLeft = view.innerWidth - width - EDGE
      const centered = rect.left + rect.width / 2 - width / 2
      this.el.style.left = `${Math.max(EDGE, Math.min(centered, maxLeft))}px`
      this.el.style.top = `${rect.bottom + EDGE}px`
    }

    /** Suit le curseur sans sortir de la fenêtre. */
    move(event) {
      if (!this.el || this.el.hidden || !event) return
      const view = this.doc.defaultView
      if (!view) return
      const width = this.el.offsetWidth || 200
      const height = this.el.offsetHeight || 80
      let left = event.clientX + OFFSET
      let top = event.clientY + OFFSET
      if (left + width > view.innerWidth - EDGE) left = event.clientX - width - OFFSET
      if (top + height > view.innerHeight - EDGE) top = event.clientY - height - OFFSET
      this.el.style.left = `${Math.max(EDGE, left)}px`
      this.el.style.top = `${Math.max(EDGE, top)}px`
    }

    hide() {
      this.index = null
      if (!this.el) return
      this.el.classList.remove('visible')
      this.el.hidden = true
    }
  }

  return {
    ChronoTooltip: ChronoTooltip,
    segmentFromNode: segmentFromNode
  }
})
