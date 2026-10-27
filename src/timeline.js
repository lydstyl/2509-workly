/*!
 * src/timeline.js — modèle de la frise chronologique (aucun DOM).
 *
 * Transforme une liste de sessions brutes (localStorage, plus récent en
 * premier) en segments ordonnés, dimensionnés et gradués.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      Object.assign({}, require('./constants.js'), require('./format.js'))
    )
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory(root.Workly))
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict'

  const SECOND = W.SECOND
  const HOUR = W.HOUR
  const MIN_SEGMENT_MS = W.MIN_SEGMENT_MS
  const MAX_TICKS = W.MAX_TICKS
  const MIN_SEGMENT_PCT = W.MIN_SEGMENT_PCT
  const FLOOR_BUDGET_PCT = W.FLOOR_BUDGET_PCT
  const formatShortDuration = W.formatShortDuration
  const formatTimeOfDay = W.formatTimeOfDay

  /** Type normalisé d'une session (« work » par défaut, tout le reste = work). */
  function normalizeType(type) {
    return type === 'break' ? 'break' : 'work'
  }

  /**
   * Durée d'une session, tolérante aux anciennes données :
   * `duration` si présent, sinon `endTime - startTime`. Jamais négative.
   */
  function sessionDuration(item) {
    if (!item || typeof item !== 'object') return 0
    const start = Number(item.startTime)
    const end = Number(item.endTime)
    const stored = Number(item.duration)
    const computed = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0
    const value = Number.isFinite(stored) && stored > 0 ? Math.max(stored, computed) : computed
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  /**
   * Assemble la chronologie complète : sessions archivées + éventuelle session
   * en cours. Le résultat est la source de vérité unique des durées.
   *
   * @param {Array} sessions timeline du state (ordre indifférent)
   * @param {{type:string,startTime:number,endTime:number}|null} [live]
   * @returns {Array<{type:string,startTime:number,endTime:number,duration:number,isLive:boolean}>}
   */
  function normalizeSessions(sessions, live) {
    const list = (Array.isArray(sessions) ? sessions : [])
      .map(function (item) {
        return {
          type: normalizeType(item && item.type),
          startTime: Number(item && item.startTime),
          endTime: Number(item && item.endTime),
          duration: sessionDuration(item),
          isLive: false
        }
      })
      .filter(function (item) {
        return Number.isFinite(item.startTime) && Number.isFinite(item.endTime)
      })

    if (live && Number.isFinite(Number(live.startTime))) {
      const startTime = Number(live.startTime)
      const endTime = Number.isFinite(Number(live.endTime)) ? Number(live.endTime) : startTime
      list.push({
        type: normalizeType(live.type),
        startTime: startTime,
        endTime: endTime,
        duration: Math.max(0, endTime - startTime),
        isLive: true
      })
    }

    return list
  }

  /**
   * Somme des durées par type (source de vérité des totaux affichés).
   * @returns {{work:number, break:number, total:number}}
   */
  function sumByType(entries) {
    let work = 0
    let breaks = 0
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].type === 'break') breaks += entries[i].duration
      else work += entries[i].duration
    }
    return { work: work, break: breaks, total: work + breaks }
  }

  /**
   * Largeurs (%) de la frise : proportionnelles aux durées, mais tout segment
   * non nul garde au moins `minWidthPct` de la barre — sinon une pause de
   * quelques secondes tombe sous le pixel et disparaît de la frise.
   *
   * Water-filling : on épingle au plancher les segments trop fins, on
   * redistribue le reste au prorata des durées, et on recommence tant qu'un
   * segment repasse sous le plancher. Le plancher effectif est borné par
   * `floorBudgetPct` (part totale maximale prise à la barre) et par 100/n.
   */
  function computeWidths(durations, totalMs, options) {
    const opts = options || {}
    const count = durations.length
    const proportional = durations.map(function (duration) {
      return totalMs > 0 ? (duration / totalMs) * 100 : 0
    })
    if (count < 2 || totalMs <= 0) return proportional

    const requested = opts.minWidthPct === undefined ? MIN_SEGMENT_PCT : opts.minWidthPct
    const budget = opts.floorBudgetPct === undefined ? FLOOR_BUDGET_PCT : opts.floorBudgetPct
    if (!(requested > 0) || !(budget > 0)) return proportional

    const pinned = []
    for (let i = 0; i < count; i += 1) {
      if (durations[i] > 0 && proportional[i] < requested) pinned.push(i)
    }
    if (!pinned.length) return proportional

    const floor = Math.min(requested, budget / pinned.length, 100 / count)
    const widths = proportional.slice()

    for (let pass = 0; pass <= count; pass += 1) {
      const free = []
      let freeMs = 0
      for (let i = 0; i < count; i += 1) {
        if (pinned.indexOf(i) === -1) {
          free.push(i)
          freeMs += durations[i]
        }
      }
      const freePct = Math.max(0, 100 - floor * pinned.length)
      let added = false
      if (freeMs > 0) {
        for (let k = 0; k < free.length; k += 1) {
          const width = (durations[free[k]] / freeMs) * freePct
          if (durations[free[k]] > 0 && width < floor) {
            pinned.push(free[k])
            added = true
          }
        }
      }
      if (added) continue

      for (let i = 0; i < count; i += 1) {
        widths[i] = pinned.indexOf(i) === -1 ? 0 : floor
      }
      if (freeMs > 0) {
        for (let k = 0; k < free.length; k += 1) {
          widths[free[k]] = (durations[free[k]] / freeMs) * freePct
        }
      }
      break
    }

    // La somme doit valoir 100 % : le résidu d'arrondi va au plus gros segment
    // (sinon les repères de l'axe dérivent par rapport à la barre).
    let sum = 0
    let biggest = 0
    for (let i = 0; i < count; i += 1) {
      sum += widths[i]
      if (widths[i] > widths[biggest]) biggest = i
    }
    if (sum > 0) widths[biggest] += 100 - sum
    return widths
  }

  /**
   * Construit le modèle de la frise : segments ordonnés chronologiquement,
   * avec largeur proportionnelle à la durée.
   *
   * @param {Array<{type:string,startTime:number,endTime:number}>} sessions
   *        Timeline brute (celle du localStorage : le plus récent en premier).
   * @param {{type:string,startTime:number,endTime:number}|null} live
   *        Session en cours (non encore archivée), ajoutée en dernier.
   * @param {{minDurationMs?:number,maxTicks?:number}} [options]
   * @returns {{segments:Array,totalMs:number,droppedMs:number,ticks:Array}}
   */
  function buildTimeline(sessions, live, options) {
    const opts = options || {}
    const minDuration = opts.minDurationMs === undefined ? MIN_SEGMENT_MS : opts.minDurationMs
    const maxTicks = opts.maxTicks === undefined ? MAX_TICKS : opts.maxTicks

    const raw = normalizeSessions(sessions, live)

    // Une session en cours est toujours gardée (même longue de 0 s) : c'est
    // elle qui dessine la frise « au fur et à mesure ».
    const kept = raw.filter(function (item) {
      return item.isLive || item.duration >= minDuration
    })
    const droppedMs =
      raw.reduce(function (acc, item) {
        return acc + item.duration
      }, 0) -
      kept.reduce(function (acc, item) {
        return acc + item.duration
      }, 0)

    kept.sort(function (a, b) {
      return a.startTime - b.startTime || a.endTime - b.endTime
    })

    const totalMs = kept.reduce(function (acc, item) {
      return acc + item.duration
    }, 0)

    let cursor = 0
    const widths = computeWidths(
      kept.map(function (item) {
        return item.duration
      }),
      totalMs,
      opts
    )
    const segments = kept.map(function (item, index) {
      const startPct = cursor
      const widthPct = widths[index]
      cursor += widthPct
      const durationMs = item.duration
      let durationLabel = formatShortDuration(durationMs)
      if (durationMs > 0 && durationMs < SECOND) durationLabel = '< 1 s'
      return {
        type: item.type,
        index: index,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: durationMs,
        durationLabel: durationLabel,
        isLive: item.isLive,
        startPct: startPct,
        endPct: startPct + widthPct,
        widthPct: widthPct,
        visible: durationMs > 0
      }
    })

    return {
      segments: segments,
      totalMs: totalMs,
      droppedMs: droppedMs,
      ticks: buildTicks(segments, maxTicks)
    }
  }

  /**
   * Position (en % de la barre) d'un instant, calculée sur la géométrie
   * *affichée* (startPct / widthPct) et non sur les durées brutes : les
   * segments courts sont élargis au plancher visuel, les repères doivent donc
   * suivre la même échelle pour rester sous le bon bloc.
   *
   * @param {Array} segments segments du modèle (avec startPct / widthPct)
   * @param {number} totalMs conservé pour compatibilité d'appel (non utilisé)
   * @param {number} timestamp instant à placer
   */
  function timeToPct(segments, totalMs, timestamp) {
    if (!segments.length) return 0
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]
      if (!(seg.duration > 0) || timestamp <= seg.startTime) return seg.startPct
      if (timestamp <= seg.endTime) {
        return seg.startPct + ((timestamp - seg.startTime) / seg.duration) * seg.widthPct
      }
    }
    return 100
  }

  /** Repères horaires (1 h, 2 h… selon l'étendue) placés sous la frise. */
  function buildTicks(segments, maxTicks) {
    if (!segments.length) return []
    const totalMs = segments.reduce(function (acc, seg) {
      return acc + seg.duration
    }, 0)
    if (totalMs <= 0) return []

    const start = segments[0].startTime
    const end = segments[segments.length - 1].endTime
    const span = Math.max(end - start, 1)

    let step = HOUR
    while (span / step > (maxTicks || MAX_TICKS) && step < 24 * HOUR) step *= 2

    const ticks = []
    let t = Math.ceil(start / step) * step
    // Un repère pile sur le début serait rogné au bord de la barre : on démarre
    // au premier multiple strictement postérieur (le début est déjà dans le résumé).
    if (t <= start) t += step
    while (t <= end && ticks.length < 200) {
      ticks.push({
        ts: t,
        pct: timeToPct(segments, totalMs, t),
        label: formatTimeOfDay(t)
      })
      t += step
    }
    return ticks
  }

  return {
    normalizeType: normalizeType,
    sessionDuration: sessionDuration,
    normalizeSessions: normalizeSessions,
    sumByType: sumByType,
    computeWidths: computeWidths,
    buildTimeline: buildTimeline,
    buildTicks: buildTicks,
    timeToPct: timeToPct
  }
})
