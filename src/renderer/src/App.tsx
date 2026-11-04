import s from './App.module.css'

export function App() {
  return (
    <div className={s.app}>
      <header className={s.toolbar} aria-label="Toolbar" />
      <main className={s.welcome}>
        <h1>gitdock</h1>
        <button type="button" disabled>
          Open local repository…
        </button>
      </main>
    </div>
  )
}
