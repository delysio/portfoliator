// Questions and notices in a modal of the page's own, in place of
// window.confirm() and window.alert().
//
// The browser's boxes cannot be styled, label their buttons in the browser's
// language rather than the page's, and say nothing about what "OK" will do.
// These name the action on the button, and a question starts with the focus on
// "Cancel", so a reflexive Enter never throws anything away.
//
// The page provides the dialog:
//
//   <dialog id="dlg-confirm" class="modal confirm">
//     <h2 id="confirm-title"></h2>
//     <p id="confirm-text"></p>
//     <div class="row confirm-actions">
//       <button type="button" id="confirm-cancel">…</button>
//       <button type="button" id="confirm-ok"></button>
//     </div>
//   </dialog>

function ask({ title, message, ok, okClass, withCancel }) {
  const dlg = document.getElementById('dlg-confirm');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  const heading = document.getElementById('confirm-title');

  heading.textContent = title || '';
  heading.hidden = !title;
  document.getElementById('confirm-text').textContent = message;
  okBtn.textContent = ok;
  okBtn.className = okClass;
  cancelBtn.hidden = !withCancel;

  return new Promise((resolve) => {
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    // Escape fires "cancel" and then "close"; either way the answer is no. The
    // event comes as a task of its own, so one left over from the previous
    // question can arrive after this one has opened the dialog again - it is
    // recognised by the dialog being open, and must not answer for this one.
    const onClose = () => { if (!dlg.open) finish(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    (withCancel ? cancelBtn : okBtn).focus();
  });
}

/**
 * Asks, and resolves to true only if the user chose the action. Escape, the
 * cancel button and closing the dialog any other way all answer no.
 */
export function confirmModal({ title, message, ok, danger = true }) {
  return ask({ title, message, ok, okClass: danger ? 'danger' : 'primary', withCancel: true });
}

/** Tells, with one button; resolves once the dialog is gone, however it went. */
export async function noticeModal({ title, message, ok = 'OK' }) {
  await ask({ title, message, ok, okClass: 'primary', withCancel: false });
}
