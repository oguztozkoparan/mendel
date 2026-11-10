import { useState, type ReactNode } from 'react'
import { Button, Dialog, Heading } from 'react-aria-components'
import a from './App.module.css'
import { DialogShell } from './motion'

/**
 * In-app destructive confirm (role="alertdialog"). Cancel has focus, so Enter confirms only once the user moved to the action;
 * Escape cancels. A rejected `onConfirm` keeps it open with the error; resolved closes it. Render inside <AnimatePresence>.
 */
export function ConfirmDialog(p: { title: string; action: string; children: ReactNode; isDisabled?: boolean; onConfirm(): Promise<unknown>; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = () => {
    setBusy(true)
    setError(null)
    p.onConfirm().then(p.onClose, (e: Error) => (setBusy(false), setError(e.message)))
  }
  return (
    <DialogShell className={a.backdrop} isDismissable={false} onOpenChange={(open) => !open && !busy && p.onClose()}>
      <Dialog role="alertdialog" className={a.dialog}>
        <Heading slot="title">{p.title}</Heading>
        {p.children}
        {error && (
          <p role="alert" className={a.error}>
            {error}
          </p>
        )}
        <div className={a.actions}>
          <Button autoFocus isDisabled={busy} onPress={p.onClose}>
            Cancel
          </Button>
          <Button className="danger" isDisabled={busy || p.isDisabled} onPress={confirm}>
            {p.action}
          </Button>
        </div>
      </Dialog>
    </DialogShell>
  )
}
