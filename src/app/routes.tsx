/**
 * Route + navigation registry.
 *
 * Adding a screen = create the page and register it here. Navigation UI is
 * generated from NAV_ITEMS so the sidebar and mobile tab bar can never drift
 * out of sync with the router.
 */

import { lazy, type ReactElement } from 'react';
import {
  AdminIcon,
  CustomersIcon,
  DeliveryIcon,
  InventoryIcon,
  MenuBookIcon,
  PosIcon,
  SalesIcon,
  TagIcon,
} from '@/components/ui/Icons';
import type { NavItem } from '@/types/navigation';

const PosPage = lazy(() => import('@/pages/PosPage'));
const SalesPage = lazy(() => import('@/pages/SalesPage'));
const CustomersPage = lazy(() => import('@/pages/CustomersPage'));
const MenuPage = lazy(() => import('@/pages/MenuPage'));
const DealsPage = lazy(() => import('@/pages/DealsPage'));
const InventoryPage = lazy(() => import('@/pages/InventoryPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const DeliveryPage = lazy(() => import('@/pages/DeliveryPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export const ROUTE_PATHS = {
  pos: '/',
  sales: '/sales',
  customers: '/customers',
  menu: '/menu',
  deals: '/deals',
  inventory: '/inventory',
  admin: '/admin',
  deliveries: '/deliveries',
} as const;

export type RoutePath = (typeof ROUTE_PATHS)[keyof typeof ROUTE_PATHS];

export interface AppRoute {
  id: string;
  /** Rendered at the layout's index path. */
  index?: boolean;
  path?: string;
  element: ReactElement;
}

/** Child routes rendered inside the app layout outlet. */
export const appRoutes: AppRoute[] = [
  { id: 'pos', index: true, element: <PosPage /> },
  { id: 'sales', path: 'sales', element: <SalesPage /> },
  { id: 'customers', path: 'customers', element: <CustomersPage /> },
  { id: 'menu', path: 'menu', element: <MenuPage /> },
  { id: 'deals', path: 'deals', element: <DealsPage /> },
  { id: 'inventory', path: 'inventory', element: <InventoryPage /> },
  { id: 'admin', path: 'admin', element: <AdminPage /> },
  { id: 'deliveries', path: 'deliveries', element: <DeliveryPage /> },
  { id: 'not-found', path: '*', element: <NotFoundPage /> },
];

/**
 * The primary sections are shared by the desktop sidebar and mobile tab bar.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    id: 'pos',
    label: 'POS',
    description: 'Take orders',
    path: ROUTE_PATHS.pos,
    icon: PosIcon,
    primary: true,
  },
  {
    id: 'sales',
    label: 'Sales',
    description: 'Transactions',
    path: ROUTE_PATHS.sales,
    icon: SalesIcon,
    primary: true,
    matchChildren: true,
  },
  {
    id: 'customers',
    label: 'Customers',
    description: 'People & history',
    path: ROUTE_PATHS.customers,
    icon: CustomersIcon,
    primary: true,
    matchChildren: true,
  },
  {
    id: 'menu',
    label: 'Menu',
    description: 'Items & prices',
    path: ROUTE_PATHS.menu,
    icon: MenuBookIcon,
    primary: true,
    matchChildren: true,
  },
  {
    id: 'deals',
    label: 'Deals',
    description: 'Bundles & offers',
    path: ROUTE_PATHS.deals,
    icon: TagIcon,
    primary: true,
    matchChildren: true,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    description: 'Stock & items',
    path: ROUTE_PATHS.inventory,
    icon: InventoryIcon,
    primary: true,
    matchChildren: true,
  },
  {
    id: 'deliveries',
    label: 'Delivery Management',
    mobileLabel: 'Delivery',
    description: 'Orders & riders',
    path: ROUTE_PATHS.deliveries,
    icon: DeliveryIcon,
    primary: true,
    matchChildren: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Configuration',
    path: ROUTE_PATHS.admin,
    icon: AdminIcon,
    primary: true,
    matchChildren: true,
  },
];
