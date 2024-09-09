import React from 'react';
import {
  Pagination,
  DefaultPaginationRenderer
} from '@components/frontStore/Pagination.js';

interface PaginationWrapperProps {
  products: {
    showProducts: number;
    products: {
      total: number;
      currentFilters: Array<{
        key: string;
        operation: string;
        value: string;
      }>;
    };
  };
}
export default function PaginationWrapper({
  products: {
    showProducts,
    products: { total, currentFilters }
  }
}: PaginationWrapperProps) {
  if (!showProducts) {
    return null;
  }
  const page = currentFilters.find((filter) => filter.key === 'page');
  const limit = currentFilters.find((filter) => filter.key === 'limit');
  console.log(limit);
  return (
    <Pagination
      total={total}
      limit={2}
      currentPage={parseInt(page?.value || '1', 10)}
    >
      {(paginationProps) => (
        <DefaultPaginationRenderer renderProps={paginationProps} />
      )}
    </Pagination>
  );
}

export const layout = {
  areaId: 'rightColumn',
  sortOrder: 30
};

export const query = `
  query Query {
    products: currentCategory {
      showProducts
      products {
        total
        currentFilters {
          key
          operation
          value
        }
      }
    }
  }`;
