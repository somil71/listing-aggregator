import React from 'react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import { Link } from 'react-router-dom';

const EFFECTIVE_DATE = 'January 1, 2025';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-24">
      <h2 className="text-xl font-black text-slate-900 dark:text-white mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">{title}</h2>
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{children}</div>
    </section>
  );
}

const TOC = [
  { id: 'acceptance',       label: 'Acceptance of Terms' },
  { id: 'description',      label: 'Description of Service' },
  { id: 'accounts',         label: 'User Accounts' },
  { id: 'acceptable-use',   label: 'Acceptable Use' },
  { id: 'prohibited',       label: 'Prohibited Activities' },
  { id: 'whatsapp',         label: 'WhatsApp Integration' },
  { id: 'ip',               label: 'Intellectual Property' },
  { id: 'privacy',          label: 'Privacy' },
  { id: 'disclaimers',      label: 'Disclaimers' },
  { id: 'liability',        label: 'Limitation of Liability' },
  { id: 'indemnification',  label: 'Indemnification' },
  { id: 'termination',      label: 'Termination' },
  { id: 'governing-law',    label: 'Governing Law' },
  { id: 'changes',          label: 'Changes to Terms' },
  { id: 'contact-terms',    label: 'Contact' },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
      <PublicNavbar />

      <div className="max-w-6xl mx-auto px-6 pt-32 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">

          {/* Sidebar TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Contents</div>
              <nav className="space-y-1">
                {TOC.map(({ id, label }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="block text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 py-1.5 border-l-2 border-transparent hover:border-blue-500 pl-3 transition-all"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <main className="lg:col-span-3">
            <div className="mb-10">
              <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Legal</div>
              <h1 className="text-4xl font-black tracking-tighter mb-3">Terms of Service</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Effective date: <strong>{EFFECTIVE_DATE}</strong></p>
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl mb-10 text-sm text-amber-700 dark:text-amber-300">
              <strong>Please read these terms carefully</strong> before using PropDigest. By accessing or using the service, you agree to be bound by these terms.
            </div>

            <Section id="acceptance" title="1. Acceptance of Terms">
              <p>By accessing or using PropDigest ("the Service"), you agree to be bound by these Terms of Service ("Terms") and our <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>. If you do not agree to these Terms, do not use the Service.</p>
              <p>These Terms apply to all visitors, users, and others who access or use the Service. By creating an account, you confirm that you are at least 18 years old and have the legal capacity to enter into these Terms.</p>
            </Section>

            <Section id="description" title="2. Description of Service">
              <p>PropDigest is a property intelligence platform that connects to WhatsApp via your personal account, monitors property listing groups you select, parses messages using AI and regex engines, and presents structured listing data and market analytics through a web dashboard.</p>
              <p>We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time with reasonable notice.</p>
            </Section>

            <Section id="accounts" title="3. User Accounts">
              <ul className="list-disc list-inside space-y-2">
                <li>You must provide accurate and complete information when creating your account.</li>
                <li>You are responsible for maintaining the security of your account credentials.</li>
                <li>You are responsible for all activity that occurs under your account.</li>
                <li>You must notify us immediately of any unauthorized use of your account.</li>
                <li>Each account is for a single user. Sharing accounts or credentials is prohibited.</li>
              </ul>
            </Section>

            <Section id="acceptable-use" title="4. Acceptable Use">
              <p>You may use PropDigest only for lawful purposes and in accordance with these Terms. You agree to use the Service for legitimate real estate research, analysis, and professional activities.</p>
            </Section>

            <Section id="prohibited" title="5. Prohibited Activities">
              <p>You agree not to:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>Use the Service to collect data without the knowledge of group participants in violation of applicable law.</li>
                <li>Resell, redistribute, or commercialize parsed listing data from PropDigest to third parties without our written permission.</li>
                <li>Attempt to reverse-engineer, decompile, or extract the source code of the Service.</li>
                <li>Use automated bots or scripts to scrape or abuse the Service's API.</li>
                <li>Attempt to gain unauthorized access to other users' data or our backend systems.</li>
                <li>Use the Service in any way that could damage, disable, or impair its operation.</li>
                <li>Upload or transmit viruses, malicious code, or other harmful content.</li>
              </ul>
            </Section>

            <Section id="whatsapp" title="6. WhatsApp Integration">
              <p>You are solely responsible for ensuring your use of PropDigest with WhatsApp complies with WhatsApp's Terms of Service and applicable local laws regarding message monitoring and privacy.</p>
              <p>You must ensure you have appropriate rights or permissions to monitor and process messages from any group you connect to PropDigest. Do not connect PropDigest to groups where monitoring would violate group rules or member expectations.</p>
              <p>PropDigest's WhatsApp integration uses the Baileys library and operates through your personal WhatsApp account. By using this feature, you accept that Meta/WhatsApp may terminate accounts using third-party automation tools.</p>
            </Section>

            <Section id="ip" title="7. Intellectual Property">
              <p>The PropDigest platform, including its software, design, trademarks, and content, is owned by PropDigest and protected by intellectual property laws. You may not copy, modify, or distribute our platform without written permission.</p>
              <p>Your listing data — data extracted from your WhatsApp groups — belongs to you. We claim no ownership over it.</p>
            </Section>

            <Section id="privacy" title="8. Privacy">
              <p>Your use of the Service is governed by our <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
            </Section>

            <Section id="disclaimers" title="9. Disclaimers">
              <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT ANY WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.</p>
              <p>We do not warrant that the Service will be uninterrupted, error-free, or that extracted listing data will be 100% accurate. Parsed data should be independently verified before making investment decisions.</p>
              <p>Market analytics provided by PropDigest are for informational purposes only and do not constitute financial or investment advice.</p>
            </Section>

            <Section id="liability" title="10. Limitation of Liability">
              <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, PROPDIGEST SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES — INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL — ARISING FROM YOUR USE OF THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
              <p>OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING FROM YOUR USE OF THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE PRECEDING 12 MONTHS (OR INR 1,000 IF YOU ARE A FREE USER).</p>
            </Section>

            <Section id="indemnification" title="11. Indemnification">
              <p>You agree to defend, indemnify, and hold harmless PropDigest and its employees, contractors, and affiliates from any claims, damages, losses, and expenses (including legal fees) arising from your use of the Service, violation of these Terms, or violation of any third party's rights.</p>
            </Section>

            <Section id="termination" title="12. Termination">
              <p>We may suspend or terminate your account at any time for violation of these Terms, with or without notice. You may terminate your account at any time by contacting us.</p>
              <p>Upon termination, your right to use the Service ceases immediately. Sections on disclaimers, liability, and governing law survive termination.</p>
            </Section>

            <Section id="governing-law" title="13. Governing Law">
              <p>These Terms are governed by the laws of India. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of India.</p>
            </Section>

            <Section id="changes" title="14. Changes to Terms">
              <p>We may update these Terms from time to time. We'll notify you of material changes via email or an in-app notice at least 14 days before they take effect. Continued use of the Service after changes constitutes acceptance of the new Terms.</p>
            </Section>

            <Section id="contact-terms" title="15. Contact">
              <p>Questions about these Terms? <Link to="/contact" className="text-blue-600 hover:underline">Contact us</Link> or email <a href="mailto:legal@propdigest.in" className="text-blue-600 hover:underline">legal@propdigest.in</a>.</p>
            </Section>
          </main>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
