/** Emoji suggested from a category name. Patterns cover EN + NL keywords. */
const RULES: [RegExp, string][] = [
  [/groceri|supermark|boodschap|albert heijn|jumbo|lidl|aldi/i, "🛒"],
  [/pizza|restaurant|dining|eten\b|uit eten|takeaway|afhaal|lunch|diner/i, "🍽️"],
  [/coffee|koffie|cafe|starbucks/i, "☕"],
  [/beer|bier|pub|kroeg|drinks|borrel|wine|wijn/i, "🍺"],
  [/car|auto\b|parking|parkeren|garage/i, "🚗"],
  [/fuel|petrol|gas station|benzine|tank(en|station)/i, "⛽"],
  [/transit|transport|train|trein|bus\b|metro|ov[- ]?chip|reis/i, "🚆"],
  [/flight|vlucht|travel|vakantie|holiday|hotel|airline/i, "✈️"],
  [/bike|fiets/i, "🚲"],
  [/rent\b|huur|mortgage|hypotheek|home|house|huis|woning/i, "🏠"],
  [/utilit|energ|electric|stroom|gas\b|water|nuts/i, "💡"],
  [/internet|phone|telefoon|mobile|mobiel|wifi|provider/i, "📱"],
  [/subscription|abonnement|software|saas|cloud/i, "💻"],
  [/insur|verzeker/i, "🛡️"],
  [/tax|belasting|btw/i, "🧾"],
  [/salar|income|inkomen|loon|payroll/i, "💰"],
  [/saving|spaar|invest|belegg|pension|pensioen/i, "📈"],
  [/bank|fee|kosten|interest|rente/i, "🏦"],
  [/health|gezond|doctor|dokter|hospital|ziekenhuis|dental|tandarts|pharma|apotheek|medic/i, "🏥"],
  [/gym|fitness|sport|workout/i, "🏋️"],
  [/movie|film|cinema|bioscoop|netflix|stream|entertain/i, "🎬"],
  [/game|gaming|spel/i, "🎮"],
  [/music|muziek|spotify|concert/i, "🎵"],
  [/book|boek|educat|onderwijs|school|study|studie|cursus|course/i, "📚"],
  [/cloth|kleding|fashion|shoe|schoen/i, "👕"],
  [/shopping|winkel|amazon|bol\.com/i, "🛍️"],
  [/hair|kapper|beauty|salon|persoonlijk|personal care/i, "💇"],
  [/gift|cadeau|present|charit|donat|goede doel/i, "🎁"],
  [/kid|child|kind|baby|school|speelgoed|toy/i, "🧸"],
  [/pet|huisdier|dog|hond|cat\b|kat\b|dieren/i, "🐾"],
];

export function suggestEmoji(name: string): string | null {
  return RULES.find(([re]) => re.test(name))?.[1] ?? null;
}
