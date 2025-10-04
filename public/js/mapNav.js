

//defining the possible languages
const langTexts = {
  en: 'English',
  es: 'Español',
  zh: '中文'
};


// Generate langArray from langTexts
const langArray = Object.keys(langTexts);
const langArrayMinusEn = langArray.filter(code => code !== 'en');



// ===== Language/ & Year Picker Setup =====
const languageToggle = document.getElementById('language-toggle');
const languageMenu = document.getElementById('language-menu');
const currentLangText = document.getElementById('current-language');

const savedLang = localStorage.getItem('preferredLang');

if (savedLang && langArray.includes(savedLang)) {
  currentLang = savedLang;
  currentLangText.textContent = langTexts[savedLang] || langTexts['en'];
}

//Language Picker: handle clicks to toggle menu
languageToggle?.addEventListener('click', e => {
  languageMenu?.classList.toggle('hidden');
  e.stopPropagation();
});

// ===== Language Setup =====
const languageSelect = document.getElementById('language-select');
const currentLangDisplay = document.getElementById('current-language');
let browserLang = navigator.language.split('-')[0];
if (savedLang && langArray.includes(savedLang)) {
  if (currentLangDisplay) currentLangDisplay.value = currentLang;
  if (languageSelect) languageSelect.value = currentLang;
} else if (langArrayMinusEn.includes(browserLang)) {
  currentLang = browserLang;
  if (languageSelect) languageSelect.value = currentLang;
}

// Language button navigation
document.querySelectorAll('.language-option').forEach(btn => {
  btn.addEventListener('click', function() {
    const lang = this.getAttribute('data-lang');
    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    window.location = url.toString();
  });
});

