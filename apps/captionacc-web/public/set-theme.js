;(function () {
  const theme = localStorage.getItem('theme') || 'system'

  const applyTheme = (theme) => {
    const html = document.documentElement

    if (theme === 'system') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (systemPrefersDark) {
        html.classList.add('dark')
      } else {
        html.classList.remove('dark')
      }
    } else if (theme === 'dark') {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
  }

  applyTheme(theme)
})()
