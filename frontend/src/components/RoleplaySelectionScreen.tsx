import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus } from 'lucide-react'
import { useStore } from '../store'
import { API_BASE } from '../hooks/useApi'

interface RoleplayScenario {
  id: string
  name: string
}

interface ScenarioCategory {
  category: string
  scenarios: RoleplayScenario[]
}

export function RoleplaySelectionScreen() {
  const { setScreen, setSelectedRoleplayId, setCustomScenario } = useStore()
  const [categories, setCategories] = useState<ScenarioCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch scenarios from backend
    fetch(`${API_BASE}/roleplay/scenarios`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`Failed to load scenarios: ${res.status} ${text}`)
        }
        return res.json()
      })
      .then(data => {
        setCategories(data.categories || [])
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load scenarios:', err)
        setLoading(false)
      })
  }, [])

  const handleBack = () => {
    setScreen('mode')
  }

  const handleScenarioSelect = (scenarioId: string) => {
    setSelectedRoleplayId(scenarioId)
    setCustomScenario(null)
    setScreen('conversation')
  }

  const handleCustomScenario = () => {
    setScreen('custom-roleplay')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full relative z-10 bg-white text-[#111111] p-6 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={handleBack}
          className="lt-back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="font-display text-xl font-semibold">Role-play scenarios</h2>
        <div className="w-11" /> {/* Spacer */}
      </div>

      {/* Scenarios List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="lt-faint">Loading scenarios...</span>
          </div>
        ) : (
          <div className="space-y-6 pb-4">
            {categories.map((category, catIndex) => (
              <div key={category.category}>
                <h3 className="lt-faint text-xs font-semibold uppercase tracking-wider mb-3 px-1">
                  {category.category}
                </h3>
                <div className="space-y-2">
                  {category.scenarios.map((scenario, scenarioIndex) => {
                    const index = catIndex * 5 + scenarioIndex // staggered entrance; was *100, which delayed later categories by seconds
                    return (
                      <motion.button
                        key={scenario.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        onClick={() => handleScenarioSelect(scenario.id)}
                        className="w-full lt-card !rounded-xl p-4 min-h-[52px] text-left"
                      >
                        <span className="font-medium">{scenario.name}</span>
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            ))}
            
            {/* Custom Scenario Button */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: categories.length * 0.1 }}
              className="pt-4 border-t lt-divider"
            >
              <button
                onClick={handleCustomScenario}
                className="w-full lt-card !rounded-xl p-4 min-h-[52px] text-left !border-dashed !border-[#9a9a9a]"
              >
                <div className="flex items-center gap-3">
                  <Plus className="w-5 h-5" />
                  <span className="font-medium">Custom scenario</span>
                </div>
              </button>
            </motion.div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

