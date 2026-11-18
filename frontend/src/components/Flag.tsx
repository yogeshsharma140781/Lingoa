import us from '../assets/flags/us.svg'
import es from '../assets/flags/es.svg'
import fr from '../assets/flags/fr.svg'
import de from '../assets/flags/de.svg'
import nl from '../assets/flags/nl.svg'
import it from '../assets/flags/it.svg'
import br from '../assets/flags/br.svg'
import india from '../assets/flags/in.svg'
import cn from '../assets/flags/cn.svg'
import jp from '../assets/flags/jp.svg'
import kr from '../assets/flags/kr.svg'

// Bundled flag images (flag-icons, MIT) instead of emoji flags: emoji flags are
// missing on some systems (they show as "?" boxes), images look the same everywhere.
const FLAGS: Record<string, string> = {
  en: us, es, fr, de, nl, it, pt: br, hi: india, zh: cn, ja: jp, ko: kr,
}

export function Flag({ code, className = 'w-8' }: { code: string; className?: string }) {
  const src = FLAGS[code]
  if (!src) return null
  return <img src={src} alt="" draggable={false} className={`${className} aspect-[4/3] rounded-[4px] object-cover shadow-sm ring-1 ring-white/10`} />
}
