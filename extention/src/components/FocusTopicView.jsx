import { useState } from 'react';

export default function FocusTopicView({ settings, onUpdateSettings }) {
  const topics = settings?.focus_topics || [];
  const activeId = settings?.active_topic_id || topics[0]?.id || null;

  const [formMode, setFormMode] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [focusRulesInput, setFocusRulesInput] = useState('');
  const [breakRulesInput, setBreakRulesInput] = useState('');

  const resetForm = () => {
    setFormMode(null);
    setNameInput('');
    setNotesInput('');
    setFocusRulesInput('');
    setBreakRulesInput('');
  };

  const handleSelectTopic = (topic) => {
    onUpdateSettings({
      active_topic_id: topic.id,
      target_topic: topic.name,
      notes: topic.notes || '',
      always_focus: topic.always_focus || [],
      always_break: topic.always_break || [],
    });
    if (formMode === 'edit') {
      setNameInput(topic.name || '');
      setNotesInput(topic.notes || '');
      setFocusRulesInput((topic.always_focus || []).join(', '));
      setBreakRulesInput((topic.always_break || []).join(', '));
    }
  };

  const handleSaveForm = () => {
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      resetForm();
      return;
    }

    const parsedFocus = focusRulesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedBreak = breakRulesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (formMode === 'create') {
      const newTopic = {
        id: `topic-${Date.now()}`,
        name: trimmedName,
        notes: notesInput.trim(),
        always_focus: parsedFocus,
        always_break: parsedBreak,
      };

      const updatedTopics = [...topics, newTopic];
      onUpdateSettings({
        focus_topics: updatedTopics,
        active_topic_id: newTopic.id,
        target_topic: newTopic.name,
        notes: newTopic.notes,
        always_focus: newTopic.always_focus,
        always_break: newTopic.always_break,
      });
    } else if (formMode === 'edit' && activeId) {
      const updatedTopics = topics.map((t) =>
        t.id === activeId
          ? {
              ...t,
              name: trimmedName,
              notes: notesInput.trim(),
              always_focus: parsedFocus,
              always_break: parsedBreak,
            }
          : t
      );

      onUpdateSettings({
        focus_topics: updatedTopics,
        active_topic_id: activeId,
        target_topic: trimmedName,
        notes: notesInput.trim(),
        always_focus: parsedFocus,
        always_break: parsedBreak,
      });
    }

    resetForm();
  };

  const handleCreateButton = () => {
    if (formMode) {
      handleSaveForm();
      return;
    }
    setNameInput('');
    setNotesInput('');
    setFocusRulesInput('');
    setBreakRulesInput('');
    setFormMode('create');
  };

  const handleEditButton = () => {
    if (formMode) {
      handleSaveForm();
      return;
    }
    const selected = topics.find((t) => t.id === activeId) || topics[0];
    if (!selected) return;
    setNameInput(selected.name || '');
    setNotesInput(selected.notes || '');
    setFocusRulesInput((selected.always_focus || []).join(', '));
    setBreakRulesInput((selected.always_break || []).join(', '));
    setFormMode('edit');
  };

  const handleDeleteOrCancelButton = () => {
    if (formMode) {
      resetForm();
      return;
    }

    if (topics.length === 0) {
      return;
    }

    const remaining = topics.filter((t) => t.id !== activeId);
    const nextActive = remaining[0] || null;
    onUpdateSettings({
      focus_topics: remaining,
      active_topic_id: nextActive ? nextActive.id : null,
      target_topic: nextActive ? nextActive.name : '',
      notes: nextActive ? nextActive.notes || '' : '',
      always_focus: nextActive ? nextActive.always_focus || [] : [],
      always_break: nextActive ? nextActive.always_break || [] : [],
    });
  };

  return (
    <>
      <div className="horizontal-container">
        <header>Focus Type</header>
      </div>

      <div className="focus-types">
        {topics.length === 0 && !formMode && (
          <div style={{ textAlign: 'center', opacity: 0.7, paddingTop: 10 }}>
            No Focus Types yet. Click Create below to add one.
          </div>
        )}

        {topics.map((topic) => {
          const isSelected = topic.id === activeId;
          return (
            <div
              key={topic.id}
              className={`topic-item ${isSelected ? 'active-topic' : ''}`}
              onClick={() => handleSelectTopic(topic)}
            >
              <div>
                <div>{topic.name}</div>
                {topic.notes ? (
                  <div style={{ fontSize: '0.8em', fontWeight: 'normal', opacity: 0.8 }}>
                    Notes: {topic.notes}
                  </div>
                ) : null}
                {topic.always_focus?.length > 0 ? (
                  <div style={{ fontSize: '0.75em', fontWeight: 'normal', opacity: 0.75 }}>
                    Safe: {topic.always_focus.join(', ')}
                  </div>
                ) : null}
              </div>
              <input
                type="radio"
                name="activeTopic"
                checked={isSelected}
                onChange={() => handleSelectTopic(topic)}
              />
            </div>
          );
        })}

        {formMode && (
          <div className="topic-form">
            <div style={{ fontWeight: 'bold', fontSize: '0.9em' }}>
              {formMode === 'create' ? 'Create Focus Type' : 'Edit Focus Type'}
            </div>
            <input
              type="text"
              placeholder="Topic name (e.g. Studying Calculus)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              placeholder="Optional notes (e.g. Allow math YouTube videos)"
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
            />
            <input
              type="text"
              placeholder="Safe Focus domains (comma-separated)"
              value={focusRulesInput}
              onChange={(e) => setFocusRulesInput(e.target.value)}
            />
            <input
              type="text"
              placeholder="Break domains (comma-separated)"
              value={breakRulesInput}
              onChange={(e) => setBreakRulesInput(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="horizontal-container">
        {formMode ? (
          <>
            <button onClick={handleSaveForm}>Save</button>
            <button onClick={handleDeleteOrCancelButton}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={handleCreateButton}>Create</button>
            <button onClick={handleEditButton} disabled={topics.length === 0}>
              Edit
            </button>
            <button onClick={handleDeleteOrCancelButton} disabled={topics.length === 0}>
              Delete
            </button>
          </>
        )}
      </div>
    </>
  );
}
