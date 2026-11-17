import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LangProvider } from '@/i18n'
import { Layout } from '@/components/Layout'
import { RequireAuth } from '@/components/RequireAuth'
import Landing from '@/pages/Landing'
import SignIn from '@/pages/SignIn'
import Transactions from '@/pages/Transactions'
import NewTransaction from '@/pages/NewTransaction'
import Join from '@/pages/Join'
import TransactionDetail from '@/pages/TransactionDetail'
import Admin from '@/pages/Admin'

export default function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="sign-in" element={<SignIn />} />
            <Route path="join" element={<Join />} />
            <Route path="transactions" element={<RequireAuth><Transactions /></RequireAuth>} />
            <Route path="transactions/new" element={<RequireAuth><NewTransaction /></RequireAuth>} />
            <Route path="transactions/:ref" element={<RequireAuth><TransactionDetail /></RequireAuth>} />
            <Route path="admin" element={<RequireAuth><Admin /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LangProvider>
  )
}
