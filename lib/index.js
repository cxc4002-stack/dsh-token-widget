// Host-side half of the token widget.
// Registers a session projection `tokenUsageBySource` that accumulates
// provider-reported token usage grouped by provider/model source.
//
// The fold mirrors dsh-token-meter's replacement rule: an assistant/chunk
// usage sample and the final assistant/message usage for the same (turn, step)
// replace each other instead of double counting.

import { z } from 'zod'

const sourceSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
})

const viewSchema = z.object({
  sources: z.record(sourceSchema),
})

/** Empty source bucket. */
const zero = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

/** Convert a provider usage report to a source bucket. */
function bucketOf(usage) {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/** Replace `previous` with `next` inside `totals` (used for same turn/step resamples). */
function replaceInTotals(totals, previous, next) {
  return {
    uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
    outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
  }
}

function bucketsEqual(left, right) {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

export function apply(ctx) {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'tokenUsageBySource',
      stateSchema: z.object({
        bySource: z.record(sourceSchema),
        currentProvider: z.string().optional(),
        currentModel: z.string().optional(),
        last: z.object({
          turn: z.number().int().nonnegative(),
          step: z.number().int().nonnegative(),
          sourceKey: z.string(),
          buckets: sourceSchema,
        }).nullable(),
      }),
      init: () => ({ bySource: {}, last: null }),
      apply(state, event) {
        // Track the latest provider/model from request header or context.
        if (event.type === 'request/header') {
          const { provider, model } = event.data.header.config
          return { ...state, currentProvider: provider, currentModel: model }
        }
        if (event.type === 'request/context') {
          const { provider, model } = event.data
          return { ...state, currentProvider: provider, currentModel: model }
        }

        // Attribute usage to the current source.
        let turn
        let step
        let usage
        if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
          ;({ turn, step } = event.data)
          usage = event.data.chunk.usage
        } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
          ;({ turn, step, usage } = event.data)
        } else {
          return state
        }
        if (usage === undefined || state.currentProvider === undefined) return state

        const sourceKey = `${state.currentProvider}/${state.currentModel}`
        const buckets = bucketOf(usage)
        const previous = state.last !== null
          && state.last.turn === turn
          && state.last.step === step
          && state.last.sourceKey === sourceKey
          ? state.last.buckets
          : undefined
        if (previous !== undefined && bucketsEqual(previous, buckets)) return state

        const current = state.bySource[sourceKey] ?? zero()
        const nextBucket = previous === undefined
          ? {
            uncachedInputTokens: current.uncachedInputTokens + buckets.uncachedInputTokens,
            outputTokens: current.outputTokens + buckets.outputTokens,
            cacheReadTokens: current.cacheReadTokens + buckets.cacheReadTokens,
            cacheWriteTokens: current.cacheWriteTokens + buckets.cacheWriteTokens,
          }
          : replaceInTotals(current, previous, buckets)

        return {
          ...state,
          bySource: { ...state.bySource, [sourceKey]: nextBucket },
          last: { turn, step, sourceKey, buckets },
        }
      },
      wire: {
        viewSchema,
        view: (state) => ({ sources: state.bySource }),
      },
      stateVersion: 1,
    })
  })
}