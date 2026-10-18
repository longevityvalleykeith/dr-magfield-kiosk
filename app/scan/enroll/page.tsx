import type { Metadata } from 'next'
import EnrollForm from './EnrollForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'DR MAGfield — Set up this tablet',
  robots: { index: false, follow: false },
}

export default function EnrollPage() {
  return <EnrollForm />
}
