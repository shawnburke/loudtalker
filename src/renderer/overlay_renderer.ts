const border = document.getElementById('border') as HTMLDivElement;

window.loudTalker.onLoudState((state: LoudState) => {
  border.classList.toggle('warning', state === 'warning');
  border.classList.toggle('limit', state === 'limit');
});
