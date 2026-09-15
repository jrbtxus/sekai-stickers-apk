// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

import { Button, Snackbar } from '@mui/material'

interface NotificationSnackbarProps {
  open: boolean
  message: string
  onClose: () => void
  duration?: number
  /** 可选的尾部操作按钮（例如「查看」刚保存的图片） */
  action?: { label: string; onClick: () => void }
}

/**
 * Reusable notification snackbar component
 */
export default function NotificationSnackbar({
  open,
  message,
  onClose,
  duration = 3000,
  action
}: NotificationSnackbarProps) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={duration}
      onClose={onClose}
      message={message}
      action={
        action ? (
          <Button color="secondary" size="small" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : undefined
      }
    />
  )
}
