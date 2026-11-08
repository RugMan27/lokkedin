import { useState } from 'react';
import { submitContactForm } from '../api/lokkedin.js';
import PopupNotification from './PopupNotification.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ContactUsView({ settings, timer }) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorPopup, setErrorPopup] = useState(null);

  const handleSubmit = async () => {
    if (submitting) return;

    const cleanMessage = message.trim();
    const cleanEmail = email.trim();

    if (!cleanMessage) {
      setErrorPopup({
        title: 'Invalid Message',
        message: 'Please enter a message before submitting.',
      });
      return;
    }

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorPopup({
        title: 'Invalid Email',
        message: 'Please enter a valid email address (for example: name@example.com).',
      });
      return;
    }

    setSubmitting(true);
    setStatus('');
    try {
      await submitContactForm({
        message: cleanMessage,
        email: cleanEmail,
        settings,
        timer,
      });
      setStatus('Sent!');
      setMessage('');
      setEmail('');
    } catch (err) {
      setErrorPopup({
        title: 'Submission Failed',
        message: `Could not send your message: ${err.message}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="horizontal-container">
        <header className="section-header">Contact Us!</header>
      </div>

      <header>Message:</header> <br />
      <textarea
        className="message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />{' '}
      <br />

      <header style={{ marginBottom: '-10px' }}>Email:</header> <br />
      <input
        type="text"
        className="email-input"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />{' '}
      <br />

      <button className="submitbutton" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Sending...' : 'Submit'}
      </button>
      {status ? <span style={{ marginLeft: 8, fontWeight: 'bold' }}>{status}</span> : null}
      <br />
      <br />
      <br />

      <header>Contact us in Email:</header>
      <a href="mailto:lokkedin@xyz" className="contactemail">
        lokkedin@xyz
      </a>

      {errorPopup && (
        <PopupNotification
          title={errorPopup.title}
          message={errorPopup.message}
          actions={[
            {
              label: 'OK',
              onClick: () => setErrorPopup(null),
            },
          ]}
        />
      )}
    </>
  );
}
