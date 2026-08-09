/* === Auth Modal (2FA) === */
// Routes the 2FA submit between the regular login flow and the isolated add-account flow.
let vrc2faTarget = 'login';

function update2FAMessage(type = vrc2faType) {
    const msgEl = document.getElementById('modal2FAMsg');
    if (!msgEl) return;
    msgEl.textContent = type === 'emailotp'
        ? t('profiles.2fa.message_email', 'Enter the 6-digit code sent to your email.')
        : t('profiles.2fa.message_app', 'Enter the 6-digit code from your authenticator app.');
}

function show2FAModal(type, target) {
    vrc2faType = type;
    vrc2faTarget = (target === 'addAccount') ? 'addAccount' : 'login';
    const m = document.getElementById('modal2FA');
    m.style.display = 'flex';
    document.getElementById('modal2FACode').value = '';
    document.getElementById('modal2FAError').textContent = '';
    update2FAMessage(type);
    setTimeout(() => document.getElementById('modal2FACode').focus(), 100);
}

function modal2FASubmit() {
    const c = document.getElementById('modal2FACode').value.trim();
    if (!c || c.length < 6) {
        document.getElementById('modal2FAError').textContent = t('profiles.2fa.enter_full_code', 'Enter the full 6-digit code');
        return;
    }
    document.getElementById('modal2FAError').textContent = t('profiles.2fa.verifying', 'Verifying...');
    const action = (vrc2faTarget === 'addAccount') ? 'addAccount2FA' : 'vrc2FA';
    sendToCS({ action, code: c, type: vrc2faType });
}
