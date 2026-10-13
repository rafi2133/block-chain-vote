import { createRouter, createWebHistory } from 'vue-router';
import ElectionsView from './views/ElectionsView.vue';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/sepolia', component: () => import('./views/SepoliaView.vue'), meta: { title: 'Sepolia deployment' } },
    { path: '/', component: ElectionsView, meta: { title: 'Elections' } },
    { path: '/elections/:id', component: () => import('./views/ElectionView.vue'), meta: { title: 'Election details' } },
    { path: '/create', component: () => import('./views/CreateView.vue'), meta: { title: 'Create election' } },
    { path: '/activity', component: () => import('./views/ActivityView.vue'), meta: { title: 'On-chain activity' } },
    { path: '/wallet', component: () => import('./views/WalletView.vue'), meta: { title: 'MetaMask setup' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
