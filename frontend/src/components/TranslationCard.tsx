import { motion } from 'framer-motion'

export interface TranslationAssist {
  source: string
  translation: string
  alternative?: string | null
}

export function TranslationCard({ translation }: { translation: TranslationAssist }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-4 text-left"
    >
      <div className="text-xs uppercase tracking-wider text-surface-500 mb-2">
        Say this
      </div>
      <div className="text-xl leading-snug text-white font-semibold">
        {translation.translation}
      </div>
      {translation.alternative && (
        <div className="mt-3 text-surface-300">
          <div className="text-xs text-surface-500 mb-1">(or)</div>
          <div className="text-base leading-snug">{translation.alternative}</div>
        </div>
      )}
    </motion.div>
  )
}


