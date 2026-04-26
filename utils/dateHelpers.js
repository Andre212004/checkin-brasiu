// ============================================
// UTILS/DATEHELPERS.JS - Funções de Data
// ============================================

/**
 * Obter semana ISO e ano atuais
 * ISO 8601: Semana começa na segunda-feira
 */
function getCurrentWeekAndYear() {
  const now = new Date();
  return getWeekAndYear(now);
}

/**
 * Calcular semana ISO de uma data específica
 * @param {Date} date 
 */
function getWeekAndYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  
  return {
    week: weekNo,
    year: d.getUTCFullYear()
  };
}

/**
 * Obter datas de início e fim de uma semana ISO
 * @param {number} week 
 * @param {number} year 
 */
function getWeekStartEnd(week, year) {
  // 4 de Janeiro está sempre na semana 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayOfWeek = jan4.getUTCDay() || 7;
  
  // Calcular segunda-feira da semana 1
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayOfWeek + 1);
  
  // Calcular segunda-feira da semana desejada
  const weekStart = new Date(week1Monday);
  weekStart.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  
  // Domingo é o último dia da semana
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  
  return {
    start: weekStart.toISOString().split('T')[0],
    end: weekEnd.toISOString().split('T')[0]
  };
}

/**
 * Verificar se uma semana já passou (está bloqueada)
 * @param {number} week 
 * @param {number} year 
 */
function isWeekLocked(week, year) {
  const current = getCurrentWeekAndYear();
  
  // Semana é de ano anterior
  if (year < current.year) {
    return true;
  }
  
  // Mesmo ano, mas semana anterior
  if (year === current.year && week < current.week) {
    return true;
  }
  
  return false;
}

/**
 * Formatar data para display (PT)
 * @param {string|Date} date 
 */
function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('pt-PT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Obter timestamp atual
 */
function now() {
  return new Date().toISOString();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  getCurrentWeekAndYear,
  getWeekAndYear,
  getWeekStartEnd,
  isWeekLocked,
  formatDate,
  now
};
