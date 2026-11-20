import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LangProvider } from '@/i18n'
import { Layout } from '@/components/Layout'
import { PublicLayout } from '@/components/PublicLayout'
import { RequireAuth } from '@/components/RequireAuth'
import Landing from '@/pages/Landing'
import SignIn from '@/pages/SignIn'
import Transactions from '@/pages/Transactions'
import NewTransaction from '@/pages/NewTransaction'
import Join from '@/pages/Join'
import TransactionDetail from '@/pages/TransactionDetail'
import Admin, { CaseDetailPage, CasesPage } from '@/pages/Admin'
import AdminOverview from '@/pages/admin/Overview'
import AdminEscrows from '@/pages/admin/Escrows'
import AdminAccounts from '@/pages/admin/Accounts'
import AdminAudit from '@/pages/admin/Audit'
import AdminSettings from '@/pages/admin/Settings'
import { PenaltyPanel } from '@/components/PenaltyPanel'
import Account from '@/pages/Account'
import HowItWorks from '@/pages/public/HowItWorks'
import Trust from '@/pages/public/Trust'
import Status from '@/pages/public/Status'
import Docs from '@/pages/public/Docs'
import Faq from '@/pages/public/Faq'
import Changelog from '@/pages/public/Changelog'
import Contact from '@/pages/public/Contact'
import Policy from '@/pages/public/Policy'

export default function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Landing />} />
            <Route path="how-it-works" element={<HowItWorks />} />
            <Route path="trust" element={<Trust />} />
            <Route path="status" element={<Status />} />
            <Route path="docs/*" element={<Docs />} />
            <Route path="faq" element={<Faq />} />
            <Route path="changelog" element={<Changelog />} />
            <Route path="contact" element={<Contact />} />
            <Route path="security" element={<Policy id="security" />} />
            <Route path="privacy" element={<Policy id="privacy" />} />
            <Route path="terms" element={<Policy id="terms" />} />
            <Route path="risk-disclosure" element={<Policy id="risk-disclosure" />} />
            <Route path="dispute-policy" element={<Policy id="dispute-policy" />} />
            <Route path="evidence-policy" element={<Policy id="evidence-policy" />} />
            <Route path="fees" element={<Policy id="fees" />} />
          </Route>
          <Route element={<Layout />}>
            <Route path="sign-in" element={<SignIn />} />
            <Route path="join" element={<Join />} />
            <Route path="transactions" element={<RequireAuth><Transactions /></RequireAuth>} />
            <Route path="transactions/new" element={<RequireAuth><NewTransaction /></RequireAuth>} />
            <Route path="transactions/:ref" element={<RequireAuth><TransactionDetail /></RequireAuth>} />
            <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
            <Route path="admin" element={<RequireAuth><Admin /></RequireAuth>}>
              <Route index element={<AdminOverview />} />
              <Route path="cases" element={<CasesPage />} />
              <Route path="cases/:publicId" element={<CaseDetailPage />} />
              <Route path="appeals" element={<CasesPage appealsOnly />} />
              <Route path="escrows" element={<AdminEscrows />} />
              <Route path="accounts" element={<AdminAccounts />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="penalty" element={<PenaltyPanel />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LangProvider>
  )
}
