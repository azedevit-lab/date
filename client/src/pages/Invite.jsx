import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { mergeContent, fillContent } from '../content.js';
import DriveGame from '../game/DriveGame.jsx';
import Chat from '../game/Chat.jsx';
import DateCard from '../game/DateCard.jsx';

export default function Invite() {
  const { token } = useParams();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('game'); // game → chat → final
  const [stats, setStats] = useState(null);
  const [result, setResult] = useState(null);
  const [chatKey, setChatKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    api(`/invite/${encodeURIComponent(token)}`)
      .then((inv) => {
        setInvite(inv);
        setStats(inv.stats);
        if (inv.completed) {
          setResult(inv.result);
          setStep('final');
        } else if (inv.arrived) {
          setStep('chat');
        }
      })
      .catch((e) => setError(e.status === 404 ? 'notfound' : 'error'));
  }, [token]);

  const c = useMemo(
    () =>
      invite &&
      fillContent(mergeContent(invite.content), {
        ad: invite.name,
        gonderen: invite.fromName || '🙂',
        gun: invite.maxDays,
      }),
    [invite],
  );

  const onArrive = useCallback(
    (s) => {
      setStats(s);
      api(`/invite/${token}/arrive`, { method: 'POST', body: s }).catch(() => {});
      setTimeout(() => setStep('chat'), 900);
    },
    [token],
  );

  const onStart = useCallback(() => {
    api(`/invite/${token}/start`, { method: 'POST' }).catch(() => {});
  }, [token]);

  const finishChat = async (answers) => {
    setSending(true);
    setSubmitError(null);
    try {
      await api(`/invite/${token}/submit`, { method: 'POST', body: answers });
      setResult(answers);
      setStep('final');
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="page">
        <div className="card center pop-in">
          <div className="big-emoji">🚫</div>
          <h2>{error === 'notfound' ? 'Bu sifariş tapılmadı' : 'Serverə qoşulmaq alınmadı'}</h2>
          <p className="muted">
            {error === 'notfound' ? 'Linki düzgün açdığından əmin ol.' : 'Bir az sonra yenidən yoxla.'}
          </p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="page">
        <div className="loader mono">🚕 ...</div>
      </div>
    );
  }

  return (
    <DriveGame
      c={c.game}
      intro={c.intro}
      message={invite.message}
      avatarName={invite.fromName}
      arrived={step !== 'game'}
      onStart={onStart}
      onArrive={onArrive}
    >
      {step === 'chat' && (
        <Chat
          key={chatKey}
          c={c.chat}
          game={c.game}
          maxDays={invite.maxDays}
          onFinish={finishChat}
          sending={sending}
          error={submitError}
        />
      )}
      {step === 'final' && result && (
        <DateCard
          c={c.final}
          game={c.game}
          stats={stats}
          result={result}
          onEdit={() => {
            setChatKey((k) => k + 1);
            setStep('chat');
          }}
        />
      )}
    </DriveGame>
  );
}
