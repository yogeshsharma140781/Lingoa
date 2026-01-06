import { useStore } from '../store'

export function YouMeantCard({ text }: { text: string }) {
  const targetLanguage = useStore((s) => s.targetLanguage)

  const label =
    targetLanguage === 'hi' ? 'आप कहना चाह रहे थे:' : "You meant:"

  return (
    <div className="glass rounded-2xl p-4 border border-white/10">
      <div className="text-surface-500 text-xs uppercase tracking-wider mb-2">
        {label}
      </div>
      <div className="text-white text-lg leading-snug">
        “{text}”
      </div>
    </div>
  )
}


