/* =========================================================
   YoungStars Hope Foundation-Africa — news.js
   Dedicated script for news.html ONLY.

   Assumes assets/js/main.min.js has already run on this page
   (header scroll state, mobile nav, back-to-top, fade-up reveal,
   footer year). This file only handles what's specific to news.html:
     1. Category filter + text search across the grid (and the
        featured post, so a search never hides it inconsistently)
     2. Read-more expand/collapse on the featured post + each card
     3. "Load More" pagination for cards beyond the initial batch

   Visibility model: each card can be hidden for two independent
   reasons — it doesn't match the current filter/search, or it's
   past the pagination cutoff. Both are tracked separately via
   data attributes and combined into one final d-none toggle, so
   the two features never fight over the same class.
   ========================================================= */
(function () {
    "use strict";

    var INITIAL_VISIBLE = 6;

    /* =====================================================
       1. READ-MORE TOGGLES (featured post + grid cards)
       ===================================================== */
    var toggleButtons = document.querySelectorAll(".news-toggle");

    toggleButtons.forEach(function (btn) {
        btn.addEventListener("click", function () {
            var card = btn.closest(".news-card, .news-featured-card");
            if (!card) return;

            var isOpen = card.classList.toggle("is-open");
            btn.setAttribute("aria-expanded", isOpen ? "true" : "false");

            btn.innerHTML = isOpen
                ? 'Show Less <i class="fas fa-chevron-down" aria-hidden="true"></i>'
                : 'Read Full Story <i class="fas fa-chevron-down" aria-hidden="true"></i>';

            if (!isOpen) {
                var rect = card.getBoundingClientRect();
                if (rect.top < 0) {
                    card.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            }
        });
    });

    /* =====================================================
       2. CATEGORY FILTER + SEARCH + PAGINATION (combined)
       ===================================================== */
    var searchInput = document.getElementById("newsSearchInput");
    var filterBtns = document.querySelectorAll(".news-filter-btn");
    var newsCards = document.querySelectorAll(".news-card");
    var featuredSection = document.querySelector(".news-featured-section");
    var featuredCard = document.querySelector(".news-featured-card");
    var emptyState = document.getElementById("newsEmptyState");
    var loadMoreWrap = document.querySelector(".news-load-more-wrap");
    var loadMoreBtn = document.getElementById("newsLoadMoreBtn");

    var activeCategory = "all";
    var paginationExpanded = false;

    function matchesFilter(el, query) {
        var matchesCategory = activeCategory === "all" || el.getAttribute("data-category") === activeCategory;
        var haystack = el.getAttribute("data-search") || "";
        var matchesQuery = !query || haystack.indexOf(query) !== -1;
        return matchesCategory && matchesQuery;
    }

    function render() {
        var query = (searchInput ? searchInput.value : "").trim().toLowerCase();
        var isFiltering = activeCategory !== "all" || !!query;
        var visibleCount = 0;

        if (featuredCard && featuredSection) {
            var featuredMatches = matchesFilter(featuredCard, query);
            featuredSection.classList.toggle("d-none", !featuredMatches);
            if (featuredMatches) visibleCount++;
        }

        var matchedCards = [];
        newsCards.forEach(function (card) {
            if (matchesFilter(card, query)) matchedCards.push(card);
        });

        newsCards.forEach(function (card) {
            var isMatch = matchedCards.indexOf(card) !== -1;
            var matchIndex = matchedCards.indexOf(card);

            // While not filtering, only the first INITIAL_VISIBLE matches
            // show unless "Load More" has been clicked. While filtering,
            // every match shows — pagination doesn't apply to search results.
            var hiddenByPagination = !isFiltering && !paginationExpanded && matchIndex >= INITIAL_VISIBLE;

            var visible = isMatch && !hiddenByPagination;
            card.classList.toggle("d-none", !visible);
            if (visible) visibleCount++;
        });

        if (emptyState) emptyState.classList.toggle("d-none", visibleCount > 0);

        if (loadMoreWrap) {
            var hasMore = !isFiltering && !paginationExpanded && matchedCards.length > INITIAL_VISIBLE;
            loadMoreWrap.classList.toggle("d-none", !hasMore);
        }
    }

    if (searchInput) searchInput.addEventListener("input", render);

    filterBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
            filterBtns.forEach(function (b) {
                b.classList.remove("is-active");
                b.setAttribute("aria-selected", "false");
            });
            btn.classList.add("is-active");
            btn.setAttribute("aria-selected", "true");
            activeCategory = btn.getAttribute("data-filter");
            render();
        });
    });

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", function () {
            paginationExpanded = true;
            render();
        });
    }

    render();
})();