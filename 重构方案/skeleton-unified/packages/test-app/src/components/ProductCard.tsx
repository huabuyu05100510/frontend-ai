import { Card, Tag, Button, Rate } from 'antd'
import { ShoppingCartOutlined } from '@ant-design/icons'

interface Product {
  id: number
  name: string
  price: number
  originalPrice: number
  rating: number
  reviews: number
  category: string
  image: string
  inStock: boolean
}

interface ProductCardProps {
  product: Product
  onAddToCart?: (id: number) => void
}

function ProductCard({ product, onAddToCart }: ProductCardProps) {
  return (
    <div data-ske-name="product-card" style={{ width: 280 }}>
      <Card
        hoverable
        cover={
          <div style={{ position: 'relative', height: 200, background: '#f5f5f5', overflow: 'hidden' }}>
            <img
              alt={product.name}
              src={product.image}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {!product.inStock && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 16, fontWeight: 600,
              }}>
                已售罄
              </div>
            )}
          </div>
        }
        actions={[
          <Button
            key="cart"
            type="primary"
            icon={<ShoppingCartOutlined />}
            disabled={!product.inStock}
            onClick={() => onAddToCart?.(product.id)}
            block
          >
            加入购物车
          </Button>,
        ]}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <Tag color="blue" style={{ margin: 0 }}>{product.category}</Tag>
          {product.inStock
            ? <Tag color="green">有货</Tag>
            : <Tag color="default">缺货</Tag>
          }
        </div>

        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>
          {product.name}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Rate disabled defaultValue={product.rating} style={{ fontSize: 12 }} />
          <span style={{ fontSize: 12, color: '#999' }}>({product.reviews}条评价)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#f5222d' }}>
            ¥{product.price}
          </span>
          <span style={{ fontSize: 13, color: '#bbb', textDecoration: 'line-through' }}>
            ¥{product.originalPrice}
          </span>
        </div>
      </Card>
    </div>
  )
}

export default ProductCard
