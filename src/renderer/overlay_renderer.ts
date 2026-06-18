const border = document.getElementById('border') as HTMLDivElement;

window.loudTalker.onLoudState((isLoud: boolean) => {
  border.classList.toggle('active', isLoud);
});
