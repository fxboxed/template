const burger = document.getElementById('burger');
const nav = document.querySelector('.header-nav');

burger.addEventListener('click', () => {
    console.log('Burger clicked');
    nav.classList.toggle('nav-open');
});