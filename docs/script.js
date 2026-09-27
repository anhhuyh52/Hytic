document.addEventListener('DOMContentLoaded', () => {
    // Animate slider widths randomly slightly to show "activity"
    const sliders = document.querySelectorAll('.slider-fill');
    setInterval(() => {
        sliders.forEach(slider => {
            if (Math.random() > 0.7) {
                const currentWidth = parseInt(slider.style.width);
                const shift = Math.floor(Math.random() * 10) - 5; // -5 to +5
                let newWidth = currentWidth + shift;
                if (newWidth < 10) newWidth = 10;
                if (newWidth > 90) newWidth = 90;
                
                slider.style.transition = 'width 1s ease';
                slider.style.width = `${newWidth}%`;
            }
        });
    }, 2000);
});
